import { createHash } from "node:crypto";
import type { FuzzyDedupConfig } from "./config";

export function trigramJaccard(a: string, b: string): number {
  const trigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const sa = trigrams(a);
  const sb = trigrams(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let intersection = 0;
  for (const t of sa) { if (sb.has(t)) intersection++; }
  const union = sa.size + sb.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function addContentDedup(
  store: Map<string, { output: string; strategy: string }>,
  rawOutput: string,
  result: { output: string; strategy: string } | null,
  fuzzyConfig?: FuzzyDedupConfig,
): { output: string; strategy: string; dedup: boolean } | null {
  if (!rawOutput || rawOutput.length < 80) return null;

  const hash = createHash("sha256").update(rawOutput).digest("hex").slice(0, 16);

  const existing = store.get(hash);
  if (existing) {
    return { output: `§ref:${hash}§ (${existing.output.split("\n")[0]})`, strategy: "dedup", dedup: true };
  }

  const fuzzy = fuzzyConfig ?? { enabled: true, similarityThreshold: 0.85, maxComparisons: 50 };
  if (fuzzy.enabled) {
    let bestSim = 0;
    let bestKey = "";
    let count = 0;
    for (const [key, _entry] of store) {
      if (count++ >= fuzzy.maxComparisons) break;
      const sim = trigramJaccard(rawOutput, key);
      if (sim > bestSim) {
        bestSim = sim;
        bestKey = key;
      }
    }
    if (bestSim >= fuzzy.similarityThreshold && bestKey) {
      const existingEntry = store.get(bestKey)!;
      return { output: `§fuzzy:${bestKey.slice(0, 8)}§ (${existingEntry.output.split("\n")[0]})`, strategy: "fuzzy-dedup", dedup: true };
    }
  }

  if (result) {
    store.set(hash, { output: result.output, strategy: result.strategy });
  }

  return result ? { ...result, dedup: false } : null;
}
