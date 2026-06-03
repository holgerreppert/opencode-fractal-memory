import type { MemoryNode } from "../storage/sqlite";

/**
 * Tokenize a string into lowercase word tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Compute the hybrid relevance score for a memory node.
 *
 *   score = 0.5 * embeddingSimilarity
 *         + 0.3 * importance
 *         + 0.2 * confidence
 *         + recencyBoost
 *         + keywordBoost
 */
export function computeHybridScore(
  node: MemoryNode,
  queryEmbedding: number[] | undefined,
  queryTerms: string[],
): number {
  // ---- Embedding similarity (cosine) ----
  let embeddingScore = 0;
  if (queryEmbedding && queryEmbedding.length && node.embedding?.length) {
    let dot = 0,
      normA = 0,
      normB = 0;
    const len = Math.min(queryEmbedding.length, node.embedding.length);
    for (let i = 0; i < len; i++) {
      const qi = queryEmbedding[i] ?? 0;
      const ni = node.embedding[i] ?? 0;
      dot += qi * ni;
      normA += qi * qi;
      normB += ni * ni;
    }
    embeddingScore = dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }

  const importance = node.importance ?? 0.5;
  const confidence = node.confidence ?? 0.5;

  // ---- Recency boost ----
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  let recencyBoost = 0;
  if (node.updatedAt instanceof Date) {
    const daysSince = (now - node.updatedAt.getTime()) / DAY_MS;
    if (daysSince < 1) recencyBoost = 0.1;
    else if (daysSince < 7) recencyBoost = 0.05;
  }

  // ---- Keyword boost (overlap between query terms and node content/label) ----
  let keywordBoost = 0;
  if (queryTerms.length) {
    const nodeTokens = tokenize(node.content + " " + (node.label ?? ""));
    let overlap = 0;
    for (const term of queryTerms) {
      if (nodeTokens.includes(term)) overlap++;
    }
    if (overlap > 0) {
      keywordBoost = Math.min(0.15, (overlap / queryTerms.length) * 0.15);
    }
  }

  // ---- Final hybrid combination ----
  return (
    0.5 * embeddingScore +
    0.3 * importance +
    0.2 * confidence +
    recencyBoost +
    keywordBoost
  );
}
