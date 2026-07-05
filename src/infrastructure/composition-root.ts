import { createSqliteMemoryStore, type MemoryStore } from "../storage/sqlite";
import type { MemConfig } from "./config/config";
import { loadMemConfig } from "./config/config";
import { generateEmbedding } from "./llm/embeddings";
import { ensureModels, ensureAgentFiles, ensureCommandFiles } from "../ensure-models";
import { createAutoRetrieveHook } from "../application";
import { startManagementServer } from "../management-server";
import { SEED_NODES } from "../seed-nodes";
import { memLog } from "../logging";
import { setCacheConfig } from "../application/cache";
import { setHighContextThreshold, setCriticalContextThreshold, setMaxInjectionTokens, setCoreInjectionTokens, setAutoCompressThreshold, cleanupMiddleTermCaptures } from "../plugin/state";

export interface ApplicationContext {
  store: MemoryStore;
  memConfig: MemConfig;
  managementStarted: boolean;
}

async function ensureSeedRules(store: MemoryStore): Promise<void> {
  let created = 0;
  let errors = 0;
  for (const seed of SEED_NODES) {
    try {
      await store.getNodeByLabel("global", seed.label);
    } catch {
      try {
        await store.createNode({
          scope: "global",
          label: seed.label,
          content: seed.content,
          summary: seed.summary ?? null,
          type: (seed.type as "event" | "episode" | "concept" | "summary" | "core" | "note" | "skill" | "playbook" | "fact" | "storedcontext" | null) ?? "note",
          level: 0,
          parentIds: null,
          embedding: null,
          importance: 1,
          metadata: seed.metadata ?? null,
        });
        created++;
      } catch (err) {
        errors++;
        memLog("warn", "init", "Failed to create seed node", { label: seed.label, error: err instanceof Error ? err.message : err });
      }
    }
  }
  memLog("info", "init", "Seed nodes checked", { total: SEED_NODES.length, created, errors });
}

async function initializeStore(directory: string, globalDbPath?: string): Promise<MemoryStore> {
  memLog("info", "init", "Creating memory store", { directory });
  const store = createSqliteMemoryStore(directory, globalDbPath);

  memLog("info", "init", "Migrating project DB to unified storage");
  const migrated = await store.migrateFromProjectDb();
  memLog("info", "init", "Project DB migration complete", { migrated });

  memLog("info", "init", "Ensuring seed nodes");
  await store.ensureSeed();
  await ensureSeedRules(store);

  return store;
}

async function ensureAssets(): Promise<void> {
  memLog("info", "init", "Ensuring models");
  await ensureModels();
  memLog("info", "init", "Ensuring agent files");
  await ensureAgentFiles().catch(() => { /* empty */ });
  memLog("info", "init", "Ensuring command files");
  await ensureCommandFiles().catch(() => { /* empty */ });
}

async function initializeConfig(directory: string, memConfig: MemConfig): Promise<void> {
  setHighContextThreshold(memConfig.highContextThreshold);
  setCriticalContextThreshold(memConfig.criticalContextThreshold);
  setMaxInjectionTokens(memConfig.maxInjectionTokens);
  setCoreInjectionTokens(memConfig.coreInjectionTokens);
  setAutoCompressThreshold(memConfig.autoCompressThreshold);
  setCacheConfig(memConfig.cacheSize, memConfig.cacheTTLHours);
}

function maybeStartManagement(store: MemoryStore, memConfig: MemConfig, directory: string): boolean {
  const mgmtConfig = memConfig.management;
  if (mgmtConfig?.enabled !== true) {
    memLog("info", "init", "Management server disabled", { enabled: mgmtConfig?.enabled });
    return false;
  }
  memLog("info", "init", "Starting management server", { port: mgmtConfig.port ?? 8787, directory });
  try {
    startManagementServer(store, directory, { enabled: true, port: mgmtConfig?.port ?? 8787 });
    memLog("info", "init", "startManagementServer returned");
    return true;
  } catch (err) {
    memLog("error", "init", "startManagementServer threw", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return false;
  }
}

export async function createApplication(directory: string, globalDbPath?: string): Promise<ApplicationContext> {
  const store = await initializeStore(directory, globalDbPath);

  await ensureAssets();

  memLog("info", "init", "Cleaning up old middle-term captures");
  await cleanupMiddleTermCaptures(store).catch(() => { /* empty */ });

  memLog("info", "init", "Loading config");
  const memConfig = await loadMemConfig(directory);
  await initializeConfig(directory, memConfig);

  const managementStarted = maybeStartManagement(store, memConfig, directory);

  return { store, memConfig, managementStarted };
}

export function createAutoRetrieve(
  store: MemoryStore,
  memConfig: MemConfig,
  client?: unknown,
  currentSessionId?: { value: string } | undefined,
) {
  return memConfig?.autoRetrieve?.enabled
    ? createAutoRetrieveHook({
        store,
        config: memConfig,
        client,
        currentSessionId,
        log: (level: string, msg: string, data?: unknown) => memLog(level as "debug" | "info" | "warn" | "error", "auto-retrieve", msg, data as Record<string, unknown> | undefined),
      })
    : null;
}

export function scheduleBackgroundEmbeddings(store: MemoryStore): void {
  setTimeout(async () => {
    try {
      const nodes = await store.listNodes("all");
      const withoutEmbeddings = nodes.filter(n => !n.embedding);
      if (withoutEmbeddings.length === 0) return;

      for (const node of withoutEmbeddings) {
        try {
          if (!node.content || node.content.trim().length < 10) continue;
          const embedding = await generateEmbedding(node.content);
          await store.updateNode(node.id, { embedding });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, 1000);
}
