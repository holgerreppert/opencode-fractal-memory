import type { MemoryNode } from "./storage/sqlite";

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

export function getWorkingCache(sessionId: string): CachedMemoryNode[] {
  const cache = workingMemoryCache.get(sessionId) || [];
  const now = Date.now();
  // Filter expired entries
  return cache.filter(n => now - n.cachedAt < CACHE_TTL_MS);
}

export function setCacheConfig(maxSize: number, ttlHours: number): void {
  CACHE_MAX_SIZE = maxSize;
  CACHE_TTL_MS = ttlHours * 60 * 60 * 1000;
}
