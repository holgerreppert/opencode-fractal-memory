import type { Database } from "bun:sqlite";
import type { MemoryNode } from "../types";
import { tokenize } from "../utils";
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

// Session-dump artifacts: storedcontext/contexthistory "session-log" dumps
// (raw [reasoning] transcripts with key_errors summaries) and
// middle-term/history snapshot blobs. They are low knowledge-density,
// chronically pollute retrieval with strong cosine matches on generic
// phrasing, and their content can be huge (up to hundreds of MB) — so they
// are excluded completely from search and context-pressure accounting. They
// remain reachable via the dedicated accessors: memory(mode=list) (metadata
// view), memory(mode=recall_context), and context(mode=middle_term).
export function isDumpNode(node: Pick<MemoryNode, "type" | "label">): boolean {
  if (node.type === "storedcontext" || node.type === "contexthistory") return true;
  const label = (node.label ?? "").toLowerCase();
  return label.startsWith("middle-term:") || label.startsWith("[history]");
}

// Type/label-based quality multiplier. Storedcontext "session-log" dumps (raw
// [reasoning] transcripts with key_errors summaries) are low knowledge-density
// and chronically pollute retrieval with strong cosine matches on generic
// phrasing, crowding out curated knowledge. Curated nodes (knowledge:/rule:/
// skill/playbook) carry the durable signal we actually want — they get a modest
// boost. Applied multiplicatively to the final RRF importance before it flows
// to pressure-aware injection (≥0.6/≥0.8), drilldown weights, and the UI.
export function computeQualityMultiplier(node: MemoryNode): number {
  const t = node.type;
  if (isDumpNode(node)) return t === "storedcontext" || t === "contexthistory" ? 0.5 : 0.6;
  const label = (node.label ?? "").toLowerCase();
  // Purpose-centric labels — the highest-value content for a coding agent
  // (ArcticMem Tier-2, Metis, LME-V2): distilled lessons, decisions with
  // rationale, confirmed conventions, and stable codebase facts.
  if (label.startsWith("lesson:") || label.startsWith("decision:") || label.startsWith("convention:") || label.startsWith("fact:") || label.startsWith("workflow:")) return 1.3;
  if (label.startsWith("knowledge:") || label.startsWith("rule:") || label.startsWith("skill:") || label.startsWith("dot:")) return 1.25;
  if (label.startsWith("plan:") || label.startsWith("task:")) return 1.1;
  if (t === "skill" || t === "playbook" || t === "core") return 1.15;
  return 1.0;
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
