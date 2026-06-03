import type { Database } from "bun:sqlite";
import type { MemoryNode, MemoryNodeLevel } from "../types";
import { tokenize } from "../utils";
import { estimateTokens } from "../../embeddings";

const CHUNK_SIZE_TOKENS = 500;
const OVERLAP_TOKENS = 50;

export interface Chunk {
  id: string;
  nodeId: string;
  content: string;
  startToken: number;
  endToken: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function updateBM25Index(db: Database, nodeId: string, content: string, label: string | undefined, scope: string): void {
  const tokens = tokenize(content + ' ' + (label ?? ''));
  const termFreq = new Map<string, number>();
  
  for (const token of tokens) {
    termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
  }
  
  db.run("DELETE FROM bm25_index WHERE node_id = ?", [nodeId]);
  db.run("DELETE FROM bm25_doc_stats WHERE node_id = ?", [nodeId]);
  
  db.run(
    "INSERT INTO bm25_doc_stats (node_id, token_count, scope) VALUES (?, ?, ?)",
    [nodeId, tokens.length, scope]
  );
  
  for (const [term, freq] of termFreq) {
    db.run(
      "INSERT INTO bm25_index (term, node_id, frequency, scope) VALUES (?, ?, ?, ?)",
      [term, nodeId, freq, scope]
    );
  }
}

export function removeBM25Index(db: Database, nodeId: string): void {
  db.run("DELETE FROM bm25_index WHERE node_id = ?", [nodeId]);
  db.run("DELETE FROM bm25_doc_stats WHERE node_id = ?", [nodeId]);
}

export function calculateDynamicBm25Weight(queryLength: number, baseWeight: number): number {
  if (queryLength === 0) return baseWeight;
  const decay = Math.max(0.3, 0.6 - 0.002 * queryLength);
  return Math.min(baseWeight, decay);
}

export function computeRecencyScore(lastAccessed: Date | null): number {
  if (!lastAccessed) return 0;
  const hoursSinceAccess = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60);
  return Math.exp(-hoursSinceAccess / 24);
}

export function chunkContent(content: string, nodeId: string): Chunk[] {
  const tokens = content.split(/\s+/);
  const chunks: Chunk[] = [];
  
  const step = CHUNK_SIZE_TOKENS - OVERLAP_TOKENS;
  
  for (let i = 0; i < tokens.length; i += step) {
    const chunkTokens = tokens.slice(i, i + CHUNK_SIZE_TOKENS);
    if (chunkTokens.length < 20) {
      if (chunks.length > 0) break;
    }
    
    chunks.push({
      id: `${nodeId}:chunk:${chunks.length}`,
      nodeId,
      content: chunkTokens.join(' '),
      startToken: i,
      endToken: Math.min(i + CHUNK_SIZE_TOKENS, tokens.length),
    });
  }
  
  return chunks;
}

export function isLargeNode(content: string): boolean {
  return estimateTokens(content) > CHUNK_SIZE_TOKENS;
}

export interface RerankResult {
  node: MemoryNode;
  originalScore: number;
  rerankScore: number;
  finalScore: number;
}

export function rerankResults(query: string, nodes: MemoryNode[], topK: number = 10): RerankResult[] {
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

const BM25_K1 = 1.2;
const BM25_B = 0.75;

type BM25Params = {
  termFrequency: number;
  documentFrequency: number;
  documentLength: number;
  averageDocumentLength: number;
  totalDocuments: number;
};

export function computeBM25TermScore(params: BM25Params): number {
  const { termFrequency, documentFrequency, documentLength, averageDocumentLength, totalDocuments } = params;
  
  if (documentFrequency === 0 || totalDocuments === 0) return 0;
  
  const idf = Math.log(totalDocuments / documentFrequency);
  const tf = termFrequency;
  const dl = documentLength;
  const avgdl = averageDocumentLength;
  
  return idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
}

type BM25ScoreInput = {
  queryTerms: string[];
  nodes: MemoryNode[];
};

export function computeBM25Scores(input: BM25ScoreInput): Map<string, number> {
  const { queryTerms, nodes } = input;
  const scores = new Map<string, number>();
  
  if (queryTerms.length === 0 || nodes.length === 0) return scores;
  
  const nodeTokens = new Map<string, { tokens: string[]; length: number }>();
  let totalLength = 0;
  
  for (const node of nodes) {
    const tokens = tokenize(node.content + ' ' + (node.label ?? ''));
    nodeTokens.set(node.id, { tokens, length: tokens.length });
    totalLength += tokens.length;
  }
  
  const avgdl = totalLength / nodes.length;
  
  for (const node of nodes) {
    const { tokens, length } = nodeTokens.get(node.id)!;
    let nodeScore = 0;
    
    for (const term of queryTerms) {
      const tf = tokens.filter(t => t === term).length;
      if (tf === 0) continue;
      
      const df = nodes.filter(n => {
        const nt = nodeTokens.get(n.id);
        return nt && nt.tokens.includes(term);
      }).length;
      
      const score = computeBM25TermScore({
        termFrequency: tf,
        documentFrequency: df,
        documentLength: length,
        averageDocumentLength: avgdl,
        totalDocuments: nodes.length,
      });
      
      nodeScore += score;
    }
    
    scores.set(node.id, nodeScore);
  }
  
  const maxScore = Math.max(...Array.from(scores.values()), 1);
  for (const [id, score] of scores) {
    scores.set(id, score / maxScore);
  }
  
  return scores;
}

export function computeBM25ScoresSQL(
  db: Database,
  scope: string,
  queryTerms: string[],
  nodeIds: string[]
): Map<string, number> {
  const scores = new Map<string, number>();
  if (queryTerms.length === 0 || nodeIds.length === 0) return scores;

  const totalDocs = (db.query("SELECT COUNT(*) as count FROM bm25_doc_stats WHERE scope = ?").get(scope) as { count: number } | undefined)?.count ?? 0;
  if (totalDocs === 0) return scores;

  const avgdl = (db.query("SELECT AVG(token_count) as avg FROM bm25_doc_stats WHERE scope = ?").get(scope) as { avg: number } | undefined)?.avg ?? 0;

  for (const nodeId of nodeIds) {
    let nodeScore = 0;
    for (const term of queryTerms) {
      const tfRow = db.query("SELECT frequency FROM bm25_index WHERE term = ? AND node_id = ?").get(term, nodeId) as { frequency: number } | null;
      if (!tfRow) continue;

      const df = (db.query("SELECT COUNT(DISTINCT node_id) as df FROM bm25_index WHERE term = ? AND scope = ?").get(term, scope) as { df: number } | undefined)?.df ?? 0;
      if (df === 0) continue;

      const docLength = (db.query("SELECT token_count FROM bm25_doc_stats WHERE node_id = ?").get(nodeId) as { token_count: number } | undefined)?.token_count ?? avgdl;

      nodeScore += computeBM25TermScore({
        termFrequency: tfRow.frequency,
        documentFrequency: df,
        documentLength: docLength,
        averageDocumentLength: avgdl,
        totalDocuments: totalDocs,
      });
    }
    scores.set(nodeId, nodeScore);
  }

  const maxScore = Math.max(...Array.from(scores.values()), 1);
  for (const [id, score] of scores) {
    scores.set(id, score / maxScore);
  }
  return scores;
}

export type SearchOptions = {
  minLevel?: MemoryNodeLevel;
  maxLevel?: MemoryNodeLevel;
  bm25Weight?: number;
  queryText?: string;
  minUsefulness?: number;
  rerank?: boolean;
  bm25Scores?: Map<string, number>;
};

export function buildScoredNodes(
  query: number[],
  nodesWithEmbeddings: Array<{ node: MemoryNode; embedding: number[]; hnswScore?: number }>,
  weights: Partial<Record<MemoryNodeLevel, number>>,
  options?: SearchOptions
): MemoryNode[] {
  const scoredNodes: MemoryNode[] = [];
  
  for (const { node, embedding, hnswScore } of nodesWithEmbeddings) {
    const level = node.level as MemoryNodeLevel;
    
    if (options?.minLevel !== undefined && level < options.minLevel) continue;
    if (options?.maxLevel !== undefined && level > options.maxLevel) continue;
    if (options?.minUsefulness !== undefined && (node.usefulnessScore ?? 0) < options.minUsefulness) continue;
    
    const baseScore = hnswScore !== undefined
      ? (cosineSimilarity(query, embedding) + hnswScore) / 2
      : cosineSimilarity(query, embedding);
    
    const levelWeight = weights[level] ?? 1;
    const confidence = node.confidence ?? 0.5;
    const confidenceWeight = 0.5 + 0.5 * confidence;
    
    scoredNodes.push({
      ...node,
      importance: baseScore * levelWeight * confidenceWeight * (1 + (node.usefulnessScore ?? 0) * 0.1),
    });
  }
  
  return scoredNodes;
}

export function computeFinalScores(
  scoredNodes: MemoryNode[],
  options?: SearchOptions
): MemoryNode[] {
  const bm25Weight = options?.bm25Weight ?? 0.4;
  const queryText = options?.queryText ?? "";
  const queryLength = queryText ? tokenize(queryText).length : 0;
  const dynamicBm25Weight = calculateDynamicBm25Weight(queryLength, bm25Weight);
  
  const bm25Scores = options?.bm25Scores ?? (bm25Weight > 0 && queryText
    ? computeBM25Scores({ queryTerms: tokenize(queryText), nodes: scoredNodes })
    : new Map<string, number>());
  
  const finalNodes: MemoryNode[] = [];
  for (const node of scoredNodes) {
    const bm25Score = bm25Scores.get(node.id) ?? 0;
    const recencyScore = computeRecencyScore(node.lastAccessed);
    
    let finalScore: number;
    if (bm25Weight > 0 && queryText) {
      const semanticWeight = 1 - dynamicBm25Weight;
      finalScore = ((node.importance ?? 0) * semanticWeight + bm25Score * dynamicBm25Weight);
    } else {
      finalScore = node.importance ?? 0;
    }
    
    finalScore = finalScore * (1 + recencyScore * 0.2);
    
    finalNodes.push({
      ...node,
      importance: finalScore,
    });
  }
  
  return finalNodes;
}