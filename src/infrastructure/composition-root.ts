import { createSqliteMemoryStore, type MemoryStore } from "../storage/sqlite";
import type { MemConfig } from "./config/config";
import { loadMemConfig } from "./config/config";
import { generateEmbeddingWithSegments } from "./llm/embeddings";
import { loadHNSWIndexFromDisk, persistHNSWIndex, getHNSWIndex } from "./vector/hnsw-index";
import { ensureModels, ensureAgentFiles, ensureCommandFiles } from "../ensure-models";
import { createAutoRetrieveHook } from "../application";
import { startManagementServer } from "../management-server";
import { SEED_NODES } from "../seed-nodes";
import { memLog, setLogLevel } from "../logging";
import { setCacheConfig } from "../application/cache";
import { setHighContextThreshold, setCriticalContextThreshold, setMaxInjectionTokens, setCoreInjectionTokens, setAutoCompressThreshold, cleanupMiddleTermCaptures } from "../plugin/state";

export interface ApplicationContext {
  store: MemoryStore;
  memConfig: MemConfig;
  managementStarted: boolean;
}

async function ensureSeedRules(store: MemoryStore): Promise<void> {
  let created = 0;
  let updated = 0;
  let errors = 0;
  for (const seed of SEED_NODES) {
    try {
      const existing = await store.getNodeByLabel("global", seed.label);
      if (existing.content !== seed.content) {
        await store.updateNode(existing.id, {
          content: seed.content,
          summary: seed.summary ?? undefined,
        });
        updated++;
      }
    } catch {
      try {
        const expired = await store.getNodeByLabel("global", seed.label, true);
        await store.updateNode(expired.id, {
          content: seed.content,
          summary: seed.summary ?? undefined,
          ttlDays: null,
          sticky: true,
        });
        updated++;
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
  }
  memLog("info", "init", "Seed nodes checked", { total: SEED_NODES.length, created, updated, errors });
}

async function initializeStore(directory: string, globalDbPath?: string): Promise<MemoryStore> {
  const rss = (): number => Math.round(process.memoryUsage().rss / 1024 / 1024);
  memLog("info", "init", "Creating memory store", { directory });
  const store = createSqliteMemoryStore(directory, globalDbPath);

  memLog("info", "init", "Migrating project DB to unified storage");
  const migrated = await store.migrateFromProjectDb();
  memLog("info", "init", "Project DB migration complete", { migrated });

  memLog("info", "init", "Ensuring seed nodes");
  await store.ensureSeed();
  await ensureSeedRules(store);

  memLog("info", "init", "Restoring HNSW index", { rssMB: rss() });
  const loaded = await loadHNSWIndexFromDisk();
  if (loaded) {
    const stats = loaded.getStats();
    memLog("info", "init", "HNSW index loaded from disk", { globalNodes: stats.globalNodes, projectNodes: stats.projectNodes, rssMB: rss() });
  } else {
    memLog("info", "init", "No HNSW index on disk — rebuilding from DB embeddings", { rssMB: rss() });
  }

  memLog("info", "init", "Reconciling HNSW index with DB", { rssMB: rss() });
  const before = getHNSWIndex().getStats();
  await store.rebuildHNSWIndex("all");
  const after = getHNSWIndex().getStats();
  const changed = before.globalNodes !== after.globalNodes || before.projectNodes !== after.projectNodes;
  const persisted = persistHNSWIndex();
  memLog("info", "init", "HNSW index reconciled", {
    beforeGlobal: before.globalNodes,
    beforeProject: before.projectNodes,
    afterGlobal: after.globalNodes,
    afterProject: after.projectNodes,
    changed,
    persisted,
    rssMB: rss(),
  });

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
  setLogLevel(memConfig.logLevel ?? "info");
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
  const rss = (): number => Math.round(process.memoryUsage().rss / 1024 / 1024);
  const MAX_EMBED_CONTENT_CHARS = 100_000;
  setTimeout(async () => {
    try {
      const nodes = await store.listNodes("all");
      const candidates = nodes.filter(n => !n.embedding);
      const skipTags = candidates.filter(n => (n.tags ?? []).some(t => t === "middle-term" || t === "storedcontext" || t === "history"));
      const skipOversized = candidates.filter(n => !skipTags.includes(n) && (n.content?.length ?? 0) > MAX_EMBED_CONTENT_CHARS);
      const withoutEmbeddings = candidates.filter(n => !skipTags.includes(n) && !skipOversized.includes(n));
      memLog("info", "embeddings", "Background embedding task started", {
        totalNodes: nodes.length,
        withoutEmbeddings: candidates.length,
        skipMiddleTerm: skipTags.length,
        skipOversized: skipOversized.length,
        toEmbed: withoutEmbeddings.length,
        rssMB: rss(),
      });
      if (withoutEmbeddings.length === 0) {
        memLog("info", "embeddings", "Background embedding task finished — nothing to do", { rssMB: rss() });
        return;
      }

      let embedded = 0;
      for (const node of withoutEmbeddings) {
        try {
          if (!node.content || node.content.trim().length < 10) continue;
          const { primary, segments } = await generateEmbeddingWithSegments(node.content);
          await store.updateNode(node.id, { embedding: primary, embeddingSegments: segments });
          embedded++;
          if (embedded % 10 === 0 || embedded === withoutEmbeddings.length) {
            memLog("info", "embeddings", "Background embedding progress", { embedded, total: withoutEmbeddings.length, rssMB: rss() });
          }
        } catch { /* ignore */ }
      }
      memLog("info", "embeddings", "Background embedding task finished", { embedded, total: withoutEmbeddings.length, rssMB: rss() });
    } catch (e) {
      memLog("error", "embeddings", "Background embedding task failed", { error: String(e), rssMB: rss() });
    }
  }, 1000);
}
