import type { MemoryStore } from "../storage/sqlite";
import { memLog } from "../logging";

export let CONTEXT_LIMIT = 128000;
export let HIGH_CONTEXT_THRESHOLD = 0.6;
export let CRITICAL_CONTEXT_THRESHOLD = 0.8;
export let MAX_INJECTION_TOKENS = 8000;
export let CORE_INJECTION_TOKENS = 2000;
export let AUTO_COMPRESS_THRESHOLD = 0.7;
export function setContextLimit(v: number) { CONTEXT_LIMIT = v; }
export function setHighContextThreshold(v: number) { HIGH_CONTEXT_THRESHOLD = v; }
export function setCriticalContextThreshold(v: number) { CRITICAL_CONTEXT_THRESHOLD = v; }
export function setMaxInjectionTokens(v: number) { MAX_INJECTION_TOKENS = v; }
export function setCoreInjectionTokens(v: number) { CORE_INJECTION_TOKENS = v; }
export function setAutoCompressThreshold(v: number) { AUTO_COMPRESS_THRESHOLD = v; }

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
