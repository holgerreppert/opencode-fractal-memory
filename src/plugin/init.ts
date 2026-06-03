import { createSqliteMemoryStore as createMemoryStore, type MemoryStore, type MemoryScope } from "../storage/sqlite";
import { loadMemConfig, type MemConfig } from "../config";
import { generateEmbedding } from "../embeddings";
import { ensureModels, ensureAgentFiles, ensureCommandFiles } from "../ensure-models";
import { createAutoRetrieveHook } from "../hooks";
import { loadConfig } from "../journal";
import { createJournalStore, type JournalContext } from "../journal";
import { startManagementServer } from "../management-server";
import { SEED_NODES } from "../seed-nodes";
import * as tools from "../tools";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { memLog } from "../logging";
import { setCacheConfig } from "../cache";
import { setContextLimit, setHighContextThreshold, setCriticalContextThreshold, setMaxInjectionTokens, setCoreInjectionTokens, setAutoCompressThreshold } from "./state";

export async function initStorage(directory: string): Promise<MemoryStore> {
  const store = createMemoryStore(directory);
  await store.ensureSeed();
  await ensureModels();
  await ensureAgentFiles().catch(() => {});
  await ensureCommandFiles().catch(() => {});
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
  for (const seed of SEED_NODES) {
    try {
      await store.getNodeByLabel("global", seed.label);
    } catch {
      await store.createNode({
        scope: "global",
        label: seed.label,
        content: seed.content,
        summary: seed.summary ?? null,
        type: (seed.type ?? "note") as any,
        level: 0,
        parentIds: null,
        embedding: null,
        importance: 1,
        metadata: seed.metadata ?? null,
      });
    }
  }
}

export async function backfillData(store: MemoryStore): Promise<void> {
  for (const scope of ["global", "project"] as MemoryScope[]) {
    await store.backfillLinks(scope);
    await store.backfillBinaryEmbeddingsAndBM25(scope);
  }
  await store.rebuildHNSWIndex();
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

export async function setupJournal(directory: string): Promise<Record<string, ToolDefinition>> {
  const config = await loadConfig();
  if (!config.journal?.enabled) return {};

  const journalStore = createJournalStore();
  return {
    journal_write: tools.JournalWrite(journalStore, { directory, model: "", provider: "" }),
    journal_read: tools.JournalRead(journalStore),
    journal_search: tools.JournalSearch(journalStore),
  };
}

export function startManagementIfEnabled(store: MemoryStore, directory: string): void {
  const config = { enabled: true, port: 8787 };
  loadConfig().then(c => {
    const mgmtConfig = c.management;
    if (mgmtConfig?.enabled === true) {
      startManagementServer(store, directory, { enabled: true, port: mgmtConfig?.port ?? 8787 });
    }
  }).catch(() => { /* config not available */ });
}

export function createAutoRetrieveIfEnabled(
  store: MemoryStore,
  memConfig: MemConfig
) {
  return memConfig?.autoRetrieve?.enabled
    ? createAutoRetrieveHook({
        store,
        config: memConfig,
        log: (level, msg, data) => memLog(level as any, "auto-retrieve", msg, data),
      })
    : null;
}
