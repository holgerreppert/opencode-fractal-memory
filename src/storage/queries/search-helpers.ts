import type { Database } from "bun:sqlite";
import type { MemoryNode, MemoryNodeLevel } from "../types";
import { tokenize } from "../utils";
import { estimateTokens } from "../../infrastructure/llm/embeddings";
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

export function computeRecencyScore(lastAccessed: Date | null): number {
  // Unknown access history → neutral recency (no penalty, no boost)
  if (!lastAccessed) return 1.0;
  const hoursSinceAccess = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60);
  return Math.exp(-hoursSinceAccess / 24);
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
  
  const idf = Math.log(1 + (totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5));
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

  // Batch 1: scope-level stats (single query instead of two)
  const stats = db.query("SELECT COUNT(*) as count, AVG(token_count) as avg FROM bm25_doc_stats WHERE scope = ?").get(scope) as { count: number; avg: number } | undefined;
  const totalDocs = stats?.count ?? 0;
  const avgdl = stats?.avg ?? 0;
  if (totalDocs === 0) return scores;

  // Batch 2: document frequency per term (moved outside node loop — same for all nodes)
  const dfMap = new Map<string, number>();
  for (const term of queryTerms) {
    const df = (db.query("SELECT COUNT(DISTINCT node_id) as df FROM bm25_index WHERE term = ? AND scope = ?").get(term, scope) as { df: number } | undefined)?.df ?? 0;
    if (df > 0) dfMap.set(term, df);
  }

  // Batch 3: all doc lengths in one query
  const docLengthMap = new Map<string, number>();
  const docLengthRows = db.query("SELECT node_id, token_count FROM bm25_doc_stats WHERE node_id IN (" + nodeIds.map(() => "?").join(",") + ")").all(...nodeIds) as { node_id: string; token_count: number }[];
  for (const row of docLengthRows) {
    docLengthMap.set(row.node_id, row.token_count);
  }

  // Batch 4: all frequencies in one query
  const freqMap = new Map<string, number>();
  const activeTerms = queryTerms.filter(t => dfMap.has(t));
  if (activeTerms.length > 0 && nodeIds.length > 0) {
    const termPlaceholders = activeTerms.map(() => "?").join(",");
    const nodePlaceholders = nodeIds.map(() => "?").join(",");
    const freqRows = db.query(
      "SELECT term, node_id, frequency FROM bm25_index WHERE term IN (" + termPlaceholders + ") AND node_id IN (" + nodePlaceholders + ")"
    ).all(...activeTerms, ...nodeIds) as { term: string; node_id: string; frequency: number }[];
    for (const row of freqRows) {
      freqMap.set(`${row.term}:${row.node_id}`, row.frequency);
    }
  }

  // Compute scores from batch data (no more DB queries in loops)
  for (const nodeId of nodeIds) {
    let nodeScore = 0;
    const docLength = docLengthMap.get(nodeId) ?? avgdl;

    for (const term of queryTerms) {
      const df = dfMap.get(term);
      if (!df) continue;

      const tf = freqMap.get(`${term}:${nodeId}`);
      if (tf === undefined) continue;

      nodeScore += computeBM25TermScore({
        termFrequency: tf,
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
  minLevel?: MemoryNodeLevel | undefined;
  maxLevel?: MemoryNodeLevel | undefined;
  rrfK?: number | undefined;
  queryText?: string | undefined;
  minUsefulness?: number | undefined;
  rerank?: boolean | undefined;
  bm25Scores?: Map<string, number> | undefined;
};

export function computeRRFScores(
  scoredNodes: MemoryNode[],
  options?: SearchOptions
): MemoryNode[] {
  // Guard against degenerate/negative k: RRF's 1/(k+rank) must keep a positive
  // denominator and a sane score spread. Config drift (k=0 or negative) would
  // otherwise produce garbage ranks or NaN normalization.
  const k = Math.max(1, options?.rrfK ?? 60);

  let bm25Rank = new Map<string, number>();
  if (options?.bm25Scores && options.bm25Scores.size > 0) {
    const ranked = Array.from(options.bm25Scores.entries()).sort((a, b) => b[1] - a[1]);
    ranked.forEach(([id], idx) => bm25Rank.set(id, idx + 1));
  }

  const bySemantic = scoredNodes
    .map((n, i) => ({ node: n, idx: i }))
    .sort((a, b) => (b.node.importance ?? 0) - (a.node.importance ?? 0));
  const semanticRank = new Map<string, number>();
  bySemantic.forEach(({ node }, i) => semanticRank.set(node.id, i + 1));

  const rrfScores: Array<{ node: MemoryNode; rrfScore: number }> = [];
  for (const { node } of bySemantic) {
    const rankSem = semanticRank.get(node.id)!;
    const rankBm25 = bm25Rank.get(node.id);

    let rrfScore = 1 / (k + rankSem);
    if (rankBm25 !== undefined) {
      rrfScore += 1 / (k + rankBm25);
    }
    rrfScores.push({ node, rrfScore });
  }

  // RRF raw scores (~1/(k+rank), ≈0.02 for k=60) are not on the [0,1]
  // importance scale downstream consumers expect (pressure-aware injection
  // filter ≥0.6/0.8, drilldown leg weights ×1.0/0.8/0.6, management UI).
  // Min-max normalize to [0,1] (top-ranked candidate → 1.0), then apply the
  // recency penalty — mirroring the old computeFinalScores ordering.
  //
  // Recency source: level ≥ 1 nodes (compressed summaries/intermediates) decay
  // from createdAt, NOT lastAccessed — searchByEmbedding re-stamps
  // last_accessed on every returned node, which would let stale group
  // summaries self-renew their recency boost forever. Level 0 details keep
  // lastAccessed (they represent working context).
  //
  // Recency is a MULTIPLICATIVE penalty (range [0.3, 1.0]), not an additive
  // boost: fresh nodes keep ~full score, stale nodes get demoted to 0.3×.
  // The old `1 + recency*0.2` formula had range [1.0, 1.2] — it only boosted
  // fresh nodes and NEVER demoted stale ones, letting 5-month-old group
  // summaries win injection every turn.
  const rawScores = rrfScores.map(s => s.rrfScore);
  const minScore = Math.min(...rawScores);
  const maxScore = Math.max(...rawScores);
  const range = maxScore - minScore;

  return rrfScores
    .map(({ node, rrfScore }) => {
      const normalized = range > 0 ? (rrfScore - minScore) / range : 1.0;
      const recencyAnchor = (node.level ?? 0) >= 1 ? node.createdAt : node.lastAccessed;
      const recencyScore = computeRecencyScore(recencyAnchor);
      return {
        ...node,
        importance: normalized * (0.3 + 0.7 * recencyScore),
      } as MemoryNode;
    })
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
}