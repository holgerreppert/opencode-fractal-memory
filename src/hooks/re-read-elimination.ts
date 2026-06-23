import * as fs from "node:fs";
import { createHash } from "node:crypto";

export interface ReadCacheEntry {
  content: string;
  mtimeMs: number;
  hash: string;
  lineCount: number;
}

const readCache = new Map<string, ReadCacheEntry>();
let maxCacheSize = 100;
let turnCounter = 0;
const seenPaths = new Map<string, number>();

export function getReadCacheSize(): number {
  return readCache.size;
}

export function getReadCacheMaxSize(): number {
  return maxCacheSize;
}

export function configureReadCache(maxSize: number): void {
  maxCacheSize = maxSize;
}

export function incrementTurn(): void {
  turnCounter++;
}

function evictIfNeeded(): void {
  while (readCache.size >= maxCacheSize) {
    const oldest = readCache.keys().next();
    if (oldest.done) break;
    readCache.delete(oldest.value);
  }
}

export async function cacheReadResult(filePath: string, content: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(filePath);
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    readCache.set(filePath, {
      content,
      mtimeMs: stat.mtimeMs,
      hash,
      lineCount: content.split("\n").length,
    });
    evictIfNeeded();
  } catch {
    /* best-effort */
  }
}

export function checkUnchangedRead(filePath: string): { cached: boolean; content: string; turn: number } | null {
  const cached = readCache.get(filePath);
  if (!cached) return null;

  try {
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs !== cached.mtimeMs) {
      return null;
    }
  } catch {
    return null;
  }

  const lastTurn = seenPaths.get(filePath) ?? 0;
  seenPaths.set(filePath, turnCounter);
  const diff = turnCounter - lastTurn;

  const banner = `[File unchanged since turn ${diff > 0 ? turnCounter - diff : 0} — ${cached.lineCount} lines, ${cached.content.length} chars]\n`;
  return { cached: true, content: banner + cached.content, turn: turnCounter };
}

export function invalidateCacheEntry(filePath: string): void {
  readCache.delete(filePath);
}
