export interface ToolDedupConfig {
  enabled: boolean;
  maxCacheEntries: number;
  protectedTools: string[];
  turnProtectionTurns: number;
}

interface CacheEntry {
  output: string;
  turn: number;
  timestamp: number;
}

function createLRU<V>(max: number): { get(key: string): V | undefined; set(key: string, val: V): void; clear(): void; size(): number } {
  const map = new Map<string, V>();
  return {
    get(key: string): V | undefined {
      if (!map.has(key)) return undefined;
      const val = map.get(key)!;
      map.delete(key);
      map.set(key, val);
      return val;
    },
    set(key: string, val: V): void {
      if (map.has(key)) map.delete(key);
      map.set(key, val);
      if (map.size > max) {
        const first = map.keys().next().value;
        if (first) map.delete(first);
      }
    },
    clear(): void { map.clear(); },
    size(): number { return map.size; },
  };
}

export function createSignature(tool: string, args: Record<string, unknown>): string {
  const canonical: Record<string, unknown> = {};
  const keys = Object.keys(args).sort();
  for (const k of keys) {
    const v = args[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      canonical[k] = v;
    } else if (typeof v === "object") {
      canonical[k] = JSON.stringify(v);
    } else {
      canonical[k] = v;
    }
  }
  return `${tool}::${JSON.stringify(canonical)}`;
}

export function createToolDedupCache(maxEntries: number) {
  const cache = createLRU<CacheEntry>(maxEntries);
  let turnCounter = 0;

  return {
    nextTurn(): void { turnCounter++; },

    check(tool: string, args: Record<string, unknown>, config: ToolDedupConfig): { cached: boolean; output: string } | null {
      if (!config.enabled) return null;
      if (config.protectedTools.includes(tool)) return null;

      const sig = createSignature(tool, args);
      const entry = cache.get(sig);
      if (!entry) return null;

      if (turnCounter - entry.turn < config.turnProtectionTurns) return null;

      return { cached: true, output: entry.output };
    },

    record(tool: string, args: Record<string, unknown>, output: string): void {
      if (!output || output.length < 20) return;
      const sig = createSignature(tool, args);
      cache.set(sig, { output, turn: turnCounter, timestamp: Date.now() });
    },

    clear(): void { cache.clear(); },
    get size(): number { return cache.size(); },
  };
}
