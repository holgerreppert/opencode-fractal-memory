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

export function addToWorkingCache(sessionId: string, node: { id: string; label?: string; content: string; importance?: number }) {
  let cache = workingMemoryCache.get(sessionId) || [];
  // Remove if already exists
  cache = cache.filter(n => n.id !== node.id);
  // Add to front (most recent)
  cache.unshift({
    id: node.id,
    label: node.label ?? node.id.slice(0, 8),
    content: node.content,
    importance: node.importance ?? 0.5,
    cachedAt: Date.now()
  });
  // Trim to max size
  if (cache.length > CACHE_MAX_SIZE) {
    cache = cache.slice(0, CACHE_MAX_SIZE);
  }
  workingMemoryCache.set(sessionId, cache);
}

export function invalidateWorkingCache(sessionId: string, nodeId?: string) {
  if (!nodeId) {
    workingMemoryCache.delete(sessionId);
    return;
  }
  const cache = workingMemoryCache.get(sessionId) || [];
  workingMemoryCache.set(sessionId, cache.filter(n => n.id !== nodeId));
}

export function setCacheConfig(maxSize: number, ttlHours: number): void {
  CACHE_MAX_SIZE = maxSize;
  CACHE_TTL_MS = ttlHours * 60 * 60 * 1000;
}
