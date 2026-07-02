import { type MemoryStore } from "../../../src/storage/types";
import { tokenize } from "../../../src/storage/utils";
import { generateEmbedding } from "../../../src/embeddings";
import { type TurnInfo, type SessionInfo } from "./ingest";

const ALL_EDGE_TYPES = ["NEXT", "DURING_SESSION", "CAUSAL", "REFERENCES", "RELATED_TO"];

export type EvidenceResult = {
  nodeId: string;
  content: string;
  score: number;
};

function bm25Search(
  db: any,
  queryTerms: string[],
  topK: number,
): Map<string, number> {
  const stats = db.query(
    "SELECT COUNT(*) as count, AVG(token_count) as avg FROM bm25_doc_stats WHERE scope = 'project'"
  ).get() as { count: number; avg: number } | undefined;
  const totalDocs = stats?.count ?? 0;
  const avgdl = stats?.avg ?? 1;
  if (totalDocs === 0) return new Map();

  const BM25_K1 = 1.2;
  const BM25_B = 0.75;

  const termNodes: Map<string, Map<string, number>> = new Map();
  const allNodeIds = new Set<string>();

  for (const term of queryTerms) {
    const rows = db.query(
      "SELECT node_id, frequency FROM bm25_index WHERE term = ? AND scope = 'project'"
    ).all(term) as { node_id: string; frequency: number }[];
    if (rows.length === 0) continue;
    const nodeFreqs = new Map<string, number>();
    for (const r of rows) {
      nodeFreqs.set(r.node_id, r.frequency);
      allNodeIds.add(r.node_id);
    }
    termNodes.set(term, nodeFreqs);
  }

  if (allNodeIds.size === 0) return new Map();

  const docLengths = new Map<string, number>();
  const ids = [...allNodeIds];
  const placeholders = ids.map(() => "?").join(",");
  const lenRows = db.query(
    `SELECT node_id, token_count FROM bm25_doc_stats WHERE node_id IN (${placeholders})`
  ).all(...ids) as { node_id: string; token_count: number }[];
  for (const r of lenRows) {
    docLengths.set(r.node_id, r.token_count);
  }

  const scores = new Map<string, number>();
  for (const nodeId of allNodeIds) {
    let nodeScore = 0;
    const docLength = docLengths.get(nodeId) ?? avgdl;
    for (const term of queryTerms) {
      const nodeFreqs = termNodes.get(term);
      if (!nodeFreqs) continue;
      const tf = nodeFreqs.get(nodeId);
      if (tf === undefined) continue;
      const df = nodeFreqs.size;
      if (df === 0) continue;
      const idf = Math.log(totalDocs / df);
      nodeScore += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgdl)));
    }
    if (nodeScore > 0) scores.set(nodeId, nodeScore);
  }

  return scores;
}

function likeFallbackSearch(db: any, queryTerms: string[], topK: number): Map<string, number> {
  const words = queryTerms.filter(t => t.length > 2);
  if (words.length === 0) return new Map();
  const conditions = words.map(() => "content LIKE ?");
  const params = words.map(w => `%${w}%`);
  const rows = db.query(
    `SELECT id FROM memory_nodes WHERE scope = 'project' AND (${conditions.join(" OR ")}) LIMIT ?`
  ).all(...params, topK) as { id: string }[];
  const scores = new Map<string, number>();
  for (const r of rows) scores.set(r.id, 0.1);
  return scores;
}

// Resolve "yesterday", "last week", etc. relative to session date
function resolveRelativeDate(text: string, sessionDateTime: string): string {
  if (!sessionDateTime) return text;
  const lower = text.toLowerCase();

  // Extract date from session datetime - handles "8 May, 2023" and "8 May 2023"
  const dateMatch = sessionDateTime.match(/(\d{1,2})\s+(\w+)[,\s]+\s*(\d{4})/);
  if (!dateMatch) return text;

  const day = parseInt(dateMatch[1]!);
  const monthStr = dateMatch[2]!;
  const year = parseInt(dateMatch[3]!);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = months.indexOf(monthStr.toLowerCase());

  if (month === -1) return text;

  const sessionDate = new Date(year, month, day);

  // Resolve relative terms
  if (lower.includes("yesterday")) {
    const resolved = new Date(sessionDate);
    resolved.setDate(resolved.getDate() - 1);
    const resolvedStr = `${resolved.getDate()} ${months[resolved.getMonth()]} ${resolved.getFullYear()}`;
    return text.replace(/\byesterday\b/gi, resolvedStr);
  }
  if (lower.includes("last week")) {
    const resolved = new Date(sessionDate);
    resolved.setDate(resolved.getDate() - 7);
    const resolvedStr = `${resolved.getDate()} ${months[resolved.getMonth()]} ${resolved.getFullYear()}`;
    return text.replace(/\blast week\b/gi, `week of ${resolvedStr}`);
  }
  if (lower.includes("last month")) {
    const resolved = new Date(sessionDate);
    resolved.setMonth(resolved.getMonth() - 1);
    const resolvedStr = `${months[resolved.getMonth()]} ${resolved.getFullYear()}`;
    return text.replace(/\blast month\b/gi, resolvedStr);
  }
  if (lower.includes("last year") || lower.includes("last year,")) {
    const resolvedStr = `${year - 1}`;
    return text.replace(/\blast year\b/gi, resolvedStr);
  }
  if (lower.includes("next week")) {
    const resolved = new Date(sessionDate);
    resolved.setDate(resolved.getDate() + 7);
    const resolvedStr = `${resolved.getDate()} ${months[resolved.getMonth()]} ${resolved.getFullYear()}`;
    return text.replace(/\bnext week\b/gi, `week of ${resolvedStr}`);
  }
  if (lower.includes("next month")) {
    const resolved = new Date(sessionDate);
    resolved.setMonth(resolved.getMonth() + 1);
    const resolvedStr = `${months[resolved.getMonth()]} ${resolved.getFullYear()}`;
    return text.replace(/\bnext month\b/gi, resolvedStr);
  }

  return text;
}

async function expandTemporalEdges(
  store: MemoryStore,
  nodeId: string,
  maxHops: number,
  visited: Set<string>,
  depth: number = 0,
): Promise<Set<string>> {
  if (depth >= maxHops || visited.has(nodeId)) return visited;
  visited.add(nodeId);

  for (const edgeType of ALL_EDGE_TYPES) {
    const edges = await store.getTemporalEdges(nodeId, "both", edgeType);
    for (const e of edges) {
      const neighborId = e.sourceNodeId === nodeId ? e.targetNodeId : e.sourceNodeId;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        await expandTemporalEdges(store, neighborId, maxHops, visited, depth + 1);
      }
    }
  }
  return visited;
}

export async function retrieveEvidence(
  store: MemoryStore,
  question: string,
  topK: number,
  turnIndex?: Map<string, TurnInfo>,
  sessions?: Map<string, SessionInfo>,
): Promise<EvidenceResult[]> {
  const db = await (store as any).getDb("project");
  const queryTerms = tokenize(question).filter(t => t.length > 2);
  if (queryTerms.length === 0) return [];

  // Phase 1: BM25 search
  let scores = bm25Search(db, queryTerms, topK * 3);
  if (scores.size === 0) {
    scores = likeFallbackSearch(db, queryTerms, topK * 3);
  }

  // Phase 2: Vector search (run alongside BM25, combine results)
  if (queryTerms.length > 0) {
    try {
      const embedding = await generateEmbedding(question);
      const vectorNodes = await store.searchByEmbedding(embedding, topK * 2, {
        bm25Weight: 0,
        queryText: question,
      });
      const vectorMax = Math.max(...vectorNodes.map(n => n.importance ?? 0.5), 1);
      for (const node of vectorNodes) {
        const vectorScore = (node.importance ?? 0.5) / vectorMax;
        const existing = scores.get(node.id);
        if (existing !== undefined) {
          scores.set(node.id, existing + vectorScore * 0.5);
        } else {
          scores.set(node.id, vectorScore * 0.5);
        }
      }
    } catch { /* embedding failed, proceed with BM25 only */ }
  }

  if (scores.size === 0) return [];

  // Get top candidates for temporal seeding
  const maxScore = Math.max(...scores.values(), 1);
  const topCandidates = [...scores.entries()]
    .map(([id, s]) => ({ nodeId: id, score: s / maxScore }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topK, 5));

  // Phase 3: Multi-hop temporal edge expansion
  const expandedIds = new Set<string>();
  for (const c of topCandidates) {
    await expandTemporalEdges(store, c.nodeId, 3, expandedIds);
  }

  // Build results with temporal context resolution
  const nodeIdToSession = new Map<string, SessionInfo>();
  if (turnIndex && sessions) {
    for (const [_label, info] of turnIndex) {
      const session = sessions.get(info.session);
      if (session) nodeIdToSession.set(info.nodeId, session);
    }
  }

  // Assign scores: BM25 scores directly, expanded nodes get decaying scores
  const temporalHopScore = new Map<string, number>();
  async function assignHopScores(nodeId: string, hopScore: number, depth: number, visitedForScore: Set<string>) {
    if (depth > 3 || visitedForScore.has(nodeId)) return;
    visitedForScore.add(nodeId);
    const existing = scores.get(nodeId);
    const base = existing !== undefined ? existing / maxScore : hopScore;
    temporalHopScore.set(nodeId, Math.max(temporalHopScore.get(nodeId) ?? 0, base));
    if (depth < 3) {
      const edges = await store.getTemporalEdges(nodeId, "both", "NEXT");
      for (const e of edges) {
        const neighborId = e.sourceNodeId === nodeId ? e.targetNodeId : e.sourceNodeId;
        await assignHopScores(neighborId, hopScore * 0.7, depth + 1, visitedForScore);
      }
    }
  }
  for (const c of topCandidates) {
    await assignHopScores(c.nodeId, c.score, 0, new Set());
  }

  const results: EvidenceResult[] = [];
  for (const nodeId of expandedIds) {
    try {
      const node = await store.getNode(nodeId);
      const finalScore = temporalHopScore.get(nodeId) ?? 0;

      let content = node.content;
      const session = nodeIdToSession.get(nodeId);
      if (session && session.dateTime) {
        content = resolveRelativeDate(content, session.dateTime);
      }

      results.push({ nodeId, content, score: finalScore });
    } catch { /* node deleted */ }
  }

  results.sort((a, b) => b.score - a.score);
  const deduped = results.filter((r, i) => results.findIndex(r2 => r2.nodeId === r.nodeId) === i);
  return deduped.slice(0, topK);
}
