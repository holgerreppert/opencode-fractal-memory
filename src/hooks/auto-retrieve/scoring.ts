import { tokenize } from "../../storage/sqlite";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Candidate {
  id: string;
  label: string;
  content: string;
  importance: number;
  confidence: number;
  usefulnessScore: number;
  accessCount: number;
  updatedAt: Date | null;
}

export function fallbackScore(
  candidates: Candidate[],
  query: string,
): { id: string; label: string; content: string; score: number }[] {
  const now = Date.now();

  const queryTerms = tokenize(query);
  const keywordBoost = new Map<string, number>();
  if (queryTerms.length > 0) {
    for (const c of candidates) {
      const nodeTokens = tokenize(c.content + " " + c.label);
      let overlap = 0;
      for (const term of queryTerms) {
        if (nodeTokens.includes(term)) overlap++;
      }
      if (overlap > 0) {
        keywordBoost.set(c.id, Math.min(0.15, (overlap / queryTerms.length) * 0.15));
      }
    }
  }

  const scored = candidates.map(c => {
    const base = 0.35 * (c.importance ?? 0.5) + 0.25 * (c.usefulnessScore ?? 0.5) + 0.15 * (c.confidence ?? 0.5);
    const access = Math.min(0.05, (c.accessCount ?? 0) * 0.005);
    const recency = (c.updatedAt instanceof Date && !isNaN(c.updatedAt.getTime()))
      ? ((now - c.updatedAt.getTime()) / DAY_MS < 1 ? 0.1 : (now - c.updatedAt.getTime()) / DAY_MS < 7 ? 0.05 : 0)
      : 0;
    const keyword = keywordBoost.get(c.id) ?? 0;
    return { id: c.id, label: c.label, content: c.content, score: base + access + recency + keyword };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
