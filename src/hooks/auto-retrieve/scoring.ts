import type { MemoryNode } from "../../storage/sqlite";
import { tokenize } from "../../storage/sqlite";

export function scoreCandidates(candidates: MemoryNode[], query: string, queryEmbedding: number[]): MemoryNode[] {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const semanticScores = new Map<string, number>();
  if (queryEmbedding.length > 0) {
    for (const node of candidates) {
      if (node.embedding && node.embedding.length > 0) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < queryEmbedding.length && i < node.embedding.length; i++) {
          const qi = queryEmbedding[i] ?? 0;
          const ni = node.embedding[i] ?? 0;
          dot += qi * ni;
          normA += qi * qi;
          normB += ni * ni;
        }
        semanticScores.set(node.id, dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8));
      }
    }
  }

  const queryTerms = tokenize(query);
  const keywordBoost = new Map<string, number>();
  if (queryTerms.length > 0) {
    for (const node of candidates) {
      const nodeTokens = tokenize(node.content + " " + (node.label ?? ""));
      let overlap = 0;
      for (const term of queryTerms) {
        if (nodeTokens.includes(term)) overlap++;
      }
      if (overlap > 0) {
        keywordBoost.set(node.id, Math.min(0.15, (overlap / queryTerms.length) * 0.15));
      }
    }
  }

  const recencyBoost = new Map<string, number>();
  for (const node of candidates) {
    if (node.updatedAt && node.updatedAt instanceof Date) {
      const daysSince = (now - node.updatedAt.getTime()) / DAY_MS;
      if (daysSince < 1) recencyBoost.set(node.id, 0.1);
      else if (daysSince < 7) recencyBoost.set(node.id, 0.05);
    }
  }

  const scored = candidates.map(node => {
    const semantic = semanticScores.get(node.id) ?? 0;
    const base = 0.4 * semantic + 0.3 * (node.importance ?? 0.5) + 0.15 * (node.confidence ?? 0.5) + 0.1 * (node.usefulnessScore ?? 0.5);
    const access = Math.min(0.05, (node.accessCount ?? 0) * 0.005);
    const recency = recencyBoost.get(node.id) ?? 0;
    const keyword = keywordBoost.get(node.id) ?? 0;
    return { node, score: base + access + recency + keyword };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.node);
}
