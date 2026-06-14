import { Database } from "bun:sqlite";
import type { MemoryScope, MemoryNode } from "./types";
import { withRetry } from "./utils";
import { memLog } from "../logging";

export async function runScoreDecay(
  getDb: (scope: MemoryScope) => Promise<Database>,
  decayDays: number
): Promise<number> {
  const now = Date.now();
  const cutoffMs = now - decayDays * 24 * 60 * 60 * 1000;
  let total = 0;

  for (const scope of ["global", "project"] as MemoryScope[]) {
    const db = await getDb(scope);
    const result = await withRetry(() => {
      return db.run(
        `UPDATE memory_nodes SET
           usefulness_score = MAX(0.1, usefulness_score * POW(0.5, (? - COALESCE(last_accessed, updated_at)) / (? * 86400000.0))),
           updated_at = ?
         WHERE COALESCE(last_accessed, updated_at) < ? AND usefulness_score > 0.1 AND (type IS NULL OR type NOT IN ('skill', 'lesson', 'rule', 'playbook'))`,
        [now, decayDays, now, cutoffMs]
      );
    });
    total += Number(result.changes ?? 0);
  }

  if (total > 0) {
    memLog("info", "score-decay", `Decayed ${total} nodes via exponential half-life (${decayDays}d)`);
  }
  return total;
}

export function calculateNodeConfidence(node: MemoryNode): number {
  if (node.type === "skill") return node.confidence;

  const age = Date.now() - node.updatedAt.getTime();
  const ageInDays = age / (24 * 60 * 60 * 1000);

  const baseConfidence = node.confidence;
  const decayFactor = Math.exp(-ageInDays / 365);
  const ageConfidence = baseConfidence * decayFactor;

  const verifiedBonus = node.lastVerified
    ? Math.max(0, 0.1 - (Date.now() - node.lastVerified.getTime()) / (24 * 60 * 60 * 1000 * 30))
    : 0;

  const finalConfidence = Math.max(0, Math.min(1, ageConfidence + verifiedBonus));
  return Math.round(finalConfidence * 100) / 100;
}
