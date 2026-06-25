import { createSqliteMemoryStore as createMemoryStore, type MemoryStore, type MemoryScope, type MemoryNodeType } from "../storage/sqlite";
import { loadMemConfig, type MemConfig } from "../config";
import { generateEmbedding } from "../embeddings";
import { ensureModels, ensureAgentFiles, ensureCommandFiles } from "../ensure-models";
import { createAutoRetrieveHook } from "../application";
import { createJournalStore, type JournalContext } from "../journal";
import { startManagementServer } from "../management-server";
import { SEED_NODES } from "../seed-nodes";
import * as tools from "../tools";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { memLog } from "../logging";
import { setCacheConfig } from "../cache";
import { setContextLimit, setHighContextThreshold, setCriticalContextThreshold, setMaxInjectionTokens, setCoreInjectionTokens, setAutoCompressThreshold, cleanupMiddleTermCaptures } from "./state";

export async function initStorage(directory: string): Promise<MemoryStore> {
  memLog("info", "init", "Creating memory store", { directory });
  const store = createMemoryStore(directory);
  memLog("info", "init", "Migrating project DB to unified storage");
  const migrated = await store.migrateFromProjectDb();
  memLog("info", "init", "Project DB migration complete", { migrated });
  memLog("info", "init", "Ensuring seed nodes");
  await store.ensureSeed();
  memLog("info", "init", "Ensuring models");
  await ensureModels();
  memLog("info", "init", "Ensuring agent files");
  await ensureAgentFiles().catch(() => {});
  memLog("info", "init", "Ensuring command files");
  await ensureCommandFiles().catch(() => {});
  memLog("info", "init", "Cleaning up old middle-term captures");
  await cleanupMiddleTermCaptures(store).catch(() => {});
  return store;
}

export async function loadPluginConfig(directory: string): Promise<MemConfig> {
  const memConfig = await loadMemConfig(directory);
  memLog("info", "config", "[plugin] Config loaded", { directory, autoRetrieve: memConfig.autoRetrieve });
  setHighContextThreshold(memConfig.highContextThreshold);
  setCriticalContextThreshold(memConfig.criticalContextThreshold);
  setMaxInjectionTokens(memConfig.maxInjectionTokens);
  setCoreInjectionTokens(memConfig.coreInjectionTokens);
  setAutoCompressThreshold(memConfig.autoCompressThreshold);
  setCacheConfig(memConfig.cacheSize, memConfig.cacheTTLHours);
  return memConfig;
}

export async function seedRuleNodes(store: MemoryStore): Promise<void> {
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
          type: seed.type as MemoryNodeType | null ?? "note",
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

export async function backfillData(store: MemoryStore): Promise<void> {
  for (const scope of ["global", "project"] as MemoryScope[]) {
    memLog("info", "init", `Backfilling links for ${scope}`);
    await store.backfillLinks(scope);
    memLog("info", "init", `Backfilling embeddings and BM25 for ${scope}`);
    await store.backfillBinaryEmbeddingsAndBM25(scope);
  }
  memLog("info", "init", "Rebuilding HNSW index");
  await store.rebuildHNSWIndex();
  memLog("info", "init", "HNSW index rebuilt");
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

export async function setupJournal(directory: string, memConfig: MemConfig): Promise<Record<string, ToolDefinition>> {
  if (!memConfig.journal?.enabled) return {};

  const journalStore = createJournalStore();
  return {
    journal_write: tools.JournalWrite(journalStore, { directory, model: "", provider: "" }),
    journal_read: tools.JournalRead(journalStore),
    journal_search: tools.JournalSearch(journalStore),
  };
}

export function startManagementIfEnabled(store: MemoryStore, directory: string, memConfig: MemConfig): void {
  const mgmtConfig = memConfig.management;
  if (mgmtConfig?.enabled === true) {
    memLog("info", "init", "Starting management server", { port: mgmtConfig.port ?? 8787 });
    startManagementServer(store, directory, { enabled: true, port: mgmtConfig?.port ?? 8787 });
  } else {
    memLog("info", "init", "Management server disabled");
  }
}

export function createAutoRetrieveIfEnabled(
  store: MemoryStore,
  memConfig: MemConfig
) {
  return memConfig?.autoRetrieve?.enabled
    ? createAutoRetrieveHook({
        store,
        config: memConfig,
        log: (level: string, msg: string, data?: unknown) => memLog(level as "debug" | "info" | "warn" | "error", "auto-retrieve", msg, data as Record<string, unknown> | undefined),
      })
    : null;
}
