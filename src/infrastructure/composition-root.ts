import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, execSync } from "node:child_process";
import { createSqliteMemoryStore, type MemoryStore } from "../storage/sqlite";
import type { MemConfig } from "./config/config";
import { loadMemConfig } from "./config/config";
import { generateEmbeddingWithSegments } from "./llm/embeddings";
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
  const updatedLabels: string[] = [];
  for (const seed of SEED_NODES) {
    try {
      const existing = await store.getNodeByLabel("global", seed.label);
      const needsUpdate =
        (existing.content ?? "") !== (seed.content ?? "") ||
        (existing.summary ?? null) !== (seed.summary ?? null);
      if (needsUpdate) {
        await store.updateNode(existing.id, {
          content: seed.content,
          summary: seed.summary ?? undefined,
          // clear embedding — old vector stale after content change, background task will re-embed
          embedding: null as unknown as number[],
        } as unknown as Parameters<typeof store.updateNode>[1]);
        updated++;
        updatedLabels.push(seed.label);
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
        updatedLabels.push(`${seed.label}:revived`);
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
  memLog("info", "init", "Seed nodes checked", { total: SEED_NODES.length, created, updated, errors, updatedLabels: updatedLabels.slice(0, 10) });
  if (updated > 0) {
    // Force ruleCache refresh on next system.transform
    memLog("info", "init", "Seed rules updated — ruleCache will refresh on next turn", { updatedLabels });
  }
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

  // Vector search now uses sqlite-vec brute-force (vec_distance_cosine) directly
  // on memory_nodes.embedding_blob — no separate HNSW graph or JSON persistence.
  // Extension is loaded lazily per-DB in search (vecBruteSearch). No startup rebuild.
  memLog("info", "init", "Vector search: sqlite-vec brute-force (no HNSW rebuild)", { rssMB: rss() });

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
  } catch (err) {
    memLog("error", "init", "startManagementServer threw", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return false;
  }
  // Parallel SvelteKit UI on sveltePort (8788) if configured and frontend/build exists — Step 3 dual serve
  const sveltePort = mgmtConfig.sveltePort;
  if (sveltePort) {
    const candidates = [
      path.join(directory, "frontend", "build"),
      path.join(process.cwd(), "frontend", "build"),
      path.join(__dirname, "..", "..", "frontend", "build"),
    ];
    const svelteBuild = candidates.find((p) => fs.existsSync(p) && fs.existsSync(path.join(p, "index.html")));
    if (svelteBuild) {
      memLog("info", "init", "Starting Svelte management server (parallel)", { sveltePort, svelteBuild, directory });
      try {
        const standalonePath = path.join(__dirname, "management-standalone.js");
        if (fs.existsSync(standalonePath)) {
          const bunPath = (() => { try { return execSync("which bun").toString().trim(); } catch { return null; } })();
          const runner = bunPath || process.execPath;
          const args = [standalonePath];
          spawn(runner, args, {
            detached: true,
            stdio: "ignore",
            env: { ...process.env, MGMT_PORT: String(sveltePort), MGMT_PROJECT_DIR: directory, MGMT_PUBLIC_DIR: svelteBuild },
          }).unref();
          memLog("info", "init", "Svelte management spawn attempted", { sveltePort, runner });
        } else {
          memLog("warn", "init", "Svelte standalone not found, skip parallel Svelte", { standalonePath });
        }
      } catch (err) {
        memLog("warn", "init", "Failed to start Svelte parallel server", { error: String(err) });
      }
    } else {
      memLog("info", "init", "Svelte build not found — skipping parallel Svelte server", { sveltePort, tried: candidates });
    }
  }
  return true;
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
