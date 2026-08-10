import type { MemoryNode } from "../../../storage/types";
import { estimateTokens } from "../../../infrastructure/llm/embeddings";

export interface RerankResult {
  node: MemoryNode;
  originalScore: number;
  rerankScore: number;
  finalScore: number;
}

/**
 * Keyword heuristic rerank: boosts candidates whose content/label matches
 * query terms. Final score blends the pipeline importance (0.7) with the
 * keyword signal (0.3). Only meaningful when more candidates than topK.
 */
export function rerankKeyword(query: string, nodes: MemoryNode[], topK: number = 10): RerankResult[] {
  if (nodes.length <= topK) {
    return nodes.map(n => ({ node: n, originalScore: n.importance ?? 0, rerankScore: 1, finalScore: n.importance ?? 0 }));
  }

  const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  const results: RerankResult[] = [];

  for (const node of nodes) {
    const contentLower = node.content.toLowerCase();
    const labelLower = (node.label ?? '').toLowerCase();

    let keywordScore = 0;
    const contentTerms = new Set(contentLower.split(/\s+/).filter(t => t.length > 2));
    for (const term of queryTerms) {
      if (contentTerms.has(term)) keywordScore += 1;
      if (labelLower.includes(term)) keywordScore += 0.5;
    }
    keywordScore = Math.min(1, keywordScore / Math.max(1, queryTerms.size));

    const firstLine = contentLower.split('\n')[0] ?? '';
    const positionScore = firstLine.includes(query.toLowerCase()) ? 0.3 : 0;

    const termDensity = keywordScore * 100 / Math.max(1, estimateTokens(node.content) / 10);
    const densityScore = Math.min(0.4, termDensity * 0.1);

    const rerankScore = keywordScore * 0.4 + positionScore + densityScore;
    const finalScore = (node.importance ?? 0) * 0.7 + rerankScore * 0.3;

    results.push({ node, originalScore: node.importance ?? 0, rerankScore, finalScore });
  }

  return results
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, topK);
}
