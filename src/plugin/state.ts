import type { MemoryStore, MemoryNode } from "../storage/sqlite";
import { getWorkingCache } from "../cache";
import type { CachedMemoryNode } from "../cache";
import { memLog } from "../logging";
import { loadMemConfig } from "../config";

export let CONTEXT_LIMIT = 128000;
export let HIGH_CONTEXT_THRESHOLD = 0.6;
export let CRITICAL_CONTEXT_THRESHOLD = 0.8;
export let MAX_INJECTION_TOKENS = 8000;
export let CORE_INJECTION_TOKENS = 2000;
export let AUTO_COMPRESS_THRESHOLD = 0.7;
export const AUTO_COMPRESS_COOLDOWN_MS = 5 * 60 * 60 * 1000;

export let lastAutoCompress = 0;
export let currentSessionId: string | null = null;

export function setContextLimit(v: number) { CONTEXT_LIMIT = v; }
export function setHighContextThreshold(v: number) { HIGH_CONTEXT_THRESHOLD = v; }
export function setCriticalContextThreshold(v: number) { CRITICAL_CONTEXT_THRESHOLD = v; }
export function setMaxInjectionTokens(v: number) { MAX_INJECTION_TOKENS = v; }
export function setCoreInjectionTokens(v: number) { CORE_INJECTION_TOKENS = v; }
export function setAutoCompressThreshold(v: number) { AUTO_COMPRESS_THRESHOLD = v; }
export function setLastAutoCompress(v: number) { lastAutoCompress = v; }
export function setCurrentSessionId(v: string | null) { currentSessionId = v; }

export async function cleanupMiddleTermCaptures(store: MemoryStore, maxAgeDays = 30): Promise<number> {
  try {
    const allNodes = await store.listNodes("all");
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const node of allNodes) {
      if (node.type !== "note") continue;
      if (node.createdAt.getTime() > cutoff) continue;
      if (!node.metadata || typeof node.metadata !== "object") continue;
      const meta = node.metadata as Record<string, unknown>;
      if (meta.customType !== "middle-term") continue;

      await store.deleteNode(node.id);
      deleted++;
    }

    if (deleted > 0) {
      memLog("info", "middle-term", `Cleaned up ${deleted} old middle-term captures (>${maxAgeDays}d)`);
    }
    return deleted;
  } catch (err) {
    memLog("warn", "middle-term", "Cleanup failed", { error: String(err) });
    return 0;
  }
}

export async function captureMiddleTermContext(
  store: MemoryStore,
  sessionId: string | undefined
): Promise<void> {
  try {
    const config = await loadMemConfig(process.cwd());
    if (!config.enableMiddleTermCapture) {
      memLog("debug", "middle-term", "Middle-term capture disabled in config");
      return;
    }

    const sid = sessionId || currentSessionId || "unknown";
    memLog("info", "middle-term", "Starting pre-compaction context capture", { sessionId: sid });

    const workingCache = getWorkingCache(sid);
    const allNodes = await store.listNodes("all");
    const recentNodes = allNodes
      .filter(n => n.importance >= 0.3)
      .sort((a, b) => (b.lastAccessed?.getTime() ?? 0) - (a.lastAccessed?.getTime() ?? 0))
      .slice(0, 20);

    const snapshot = {
      timestamp: new Date().toISOString(),
      sessionId: sid,
      type: "middle-term-context",
      workingCache: workingCache.map((n: CachedMemoryNode) => ({
        id: n.id,
        label: n.label,
        importance: n.importance,
        cachedAt: n.cachedAt,
      })),
      recentNodes: recentNodes.slice(0, 10).map(n => ({
        id: n.id,
        label: n.label,
        importance: n.importance,
        level: n.level,
      })),
      contextTokens: workingCache.reduce((sum, n) => sum + (n.content ? n.content.length / 4 : 0), 0),
    };

    const label = `middle-term:${sid}:${Date.now()}`;
    const content = JSON.stringify(snapshot, null, 2);

    await store.createNode({
      scope: "project",
      label,
      content,
      level: 0,
      sticky: true,
      importance: 0.8,
      type: "note",
      metadata: { tags: ["middle-term", "pre-compaction", sid], customType: "middle-term" },
    });

    memLog("info", "middle-term", "Captured pre-compaction context", {
      sessionId: sid,
      nodeCount: workingCache.length,
      label,
    });
  } catch (err) {
    memLog("warn", "middle-term", "Failed to capture context", { error: String(err) });
  }
}
