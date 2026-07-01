
export interface CachedMemoryNode {
  id: string;
  label: string;
  content: string;
  importance: number;
  cachedAt: number;
}

const workingMemoryCache: Map<string, CachedMemoryNode[]> = new Map();
let CACHE_MAX_SIZE = 8;
let CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_STALE_SESSIONS = 100;

function pruneStaleSessions(): void {
  if (workingMemoryCache.size <= MAX_STALE_SESSIONS) return;
  const now = Date.now();
  for (const [sessionId, entries] of workingMemoryCache) {
    if (entries.every(n => now - n.cachedAt >= CACHE_TTL_MS)) {
      workingMemoryCache.delete(sessionId);
    }
    if (workingMemoryCache.size <= MAX_STALE_SESSIONS) break;
  }
}

export function getWorkingCache(sessionId: string): CachedMemoryNode[] {
  const cache = workingMemoryCache.get(sessionId) || [];
  const now = Date.now();
  return cache.filter(n => now - n.cachedAt < CACHE_TTL_MS);
}

export function addToWorkingCache(sessionId: string, node: { id: string; label: string; content: string; importance: number }): void {
  if (!workingMemoryCache.has(sessionId)) {
    workingMemoryCache.set(sessionId, []);
  }
  const cache = workingMemoryCache.get(sessionId)!;
  const existingIdx = cache.findIndex(n => n.label === node.label || n.id === node.id);
  const entry = { ...node, cachedAt: Date.now() };
  if (existingIdx >= 0) {
    cache[existingIdx] = entry;
  } else {
    cache.push(entry);
    if (cache.length > CACHE_MAX_SIZE) {
      cache.sort((a, b) => b.importance - a.importance);
      cache.length = CACHE_MAX_SIZE;
    }
  }
  pruneStaleSessions();
}

export function clearWorkingCache(sessionId: string): void {
  workingMemoryCache.delete(sessionId);
}

export function setCacheConfig(maxSize: number, ttlHours: number): void {
  CACHE_MAX_SIZE = maxSize;
  CACHE_TTL_MS = ttlHours * 60 * 60 * 1000;
}
