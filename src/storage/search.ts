import { Database } from "bun:sqlite";
import type { MemoryScope, MemoryNode, MemoryNodeLevel, MemoryNodeType, MemoryCategory, MemoryDomain, SearchIntent } from "../domain/ports/MemoryStore";
import type { SqliteNode } from "./queries/base";
import { rowToNode } from "./queries/base";
import { getHNSWIndex } from "../infrastructure/vector/hnsw-index";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import { cosineSimilarity } from "../math";
import { computeBM25ScoresSQL } from "./queries/search-helpers";
import { tokenize, blobToEmbedding } from "./utils";
import { rankCandidates, toRankedNodes, type RankCandidate } from "../application/ranking/pipeline";
import { DEFAULT_RANK_WEIGHTS, type RankWeights } from "../application/ranking/weights";
import { rerank, type RerankMode } from "../application/ranking/rerank";
import { memLog } from "../logging";

let fallbackLogged = false;
let fallbackCount = 0;

function matchesTagsFilter(nodeTags: string[] | null, tagsFilter: string[] | undefined): boolean {
  if (!tagsFilter || tagsFilter.length === 0) return true;
  if (!nodeTags || nodeTags.length === 0) return tagsFilter.length === 0;
  return tagsFilter.every(t => nodeTags.includes(t));
}

const ALL_EDGE_TYPES = ["NEXT", "DURING_SESSION", "CAUSAL", "REFERENCES", "RELATED_TO"];

async function expandTemporalEdges(
  getDb: (scope: MemoryScope) => Promise<Database>,
  nodeId: string,
  maxHops: number,
  visited: Set<string>,
  depth: number = 0,
): Promise<Set<string>> {
  if (depth >= maxHops || visited.has(nodeId)) return visited;
  visited.add(nodeId);
  const db = await getDb("project");
  const rows = db.query(
    `SELECT source_node_id, target_node_id FROM temporal_edges WHERE edge_type IN (${ALL_EDGE_TYPES.map(() => "?").join(",")}) AND (source_node_id = ? OR target_node_id = ?)`
  ).all(...ALL_EDGE_TYPES, nodeId, nodeId) as { source_node_id: string; target_node_id: string }[];
  for (const row of rows) {
    const neighborId = row.source_node_id === nodeId ? row.target_node_id : row.source_node_id;
    if (!visited.has(neighborId)) {
      await expandTemporalEdges(getDb, neighborId, maxHops, visited, depth + 1);
    }
  }
  return visited;
}

async function assignTemporalHopScores(
  getDb: (scope: MemoryScope) => Promise<Database>,
  nodeId: string,
  hopScore: number,
  depth: number,
  maxHops: number,
  visited: Set<string>,
  scores: Map<string, number>,
): Promise<void> {
  if (depth > maxHops || visited.has(nodeId)) return;
  visited.add(nodeId);
  const existing = scores.get(nodeId) ?? 0;
  scores.set(nodeId, Math.max(existing, hopScore));
  if (depth < maxHops) {
    const db = await getDb("project");
    const rows = db.query(
      `SELECT source_node_id, target_node_id, confidence FROM temporal_edges WHERE edge_type IN (${ALL_EDGE_TYPES.map(() => "?").join(",")}) AND (source_node_id = ? OR target_node_id = ?)`
    ).all(...ALL_EDGE_TYPES, nodeId, nodeId) as { source_node_id: string; target_node_id: string; confidence: number }[];
    for (const row of rows) {
      const neighborId = row.source_node_id === nodeId ? row.target_node_id : row.source_node_id;
      const decay = (row.confidence ?? 0.5) * 0.8;
      await assignTemporalHopScores(getDb, neighborId, hopScore * decay, depth + 1, maxHops, visited, scores);
    }
  }
}

export async function searchByEmbedding(
  getDb: (scope: MemoryScope) => Promise<Database>,
  query: number[],
  limit: number = 5,
  options?: {
    minLevel?: MemoryNodeLevel | undefined;
    maxLevel?: MemoryNodeLevel | undefined;
    levelWeights?: Partial<Record<MemoryNodeLevel, number>> | undefined;
    queryText?: string | undefined;
    minUsefulness?: number | undefined;
    rerank?: boolean | undefined;
    rerankMode?: "keyword" | "cross-encoder" | undefined;
    bm25Scores?: Map<string, number> | undefined;
    projectName?: string | undefined;
    temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number } | undefined;
    temporalHops?: number | undefined;
    categoryFilter?: MemoryCategory | undefined;
    typeFilter?: MemoryNodeType | undefined;
    domainFilter?: MemoryDomain | undefined;
    intent?: SearchIntent | undefined;
    tagsFilter?: string[] | undefined;
    featureWeights?: Partial<RankWeights> | undefined;
  }
): Promise<MemoryNode[]> {
  const weights: RankWeights = { ...DEFAULT_RANK_WEIGHTS, ...(options?.featureWeights ?? {}) };

  const doRerank = options?.rerank ?? false;
  const queryText = options?.queryText ?? "";

  const hnsw = getHNSWIndex();
  const hnswResults = await hnsw.search(query, limit * 5);

  const candidates: RankCandidate[] = [];

  if (hnswResults.length > 0) {
    const candidateIds = new Set(hnswResults.map(r => r.id));
    const hnswScoreMap = new Map<string, number>();
    for (const r of hnswResults) {
      const existing = hnswScoreMap.get(r.id) ?? -Infinity;
      if (r.score > existing) hnswScoreMap.set(r.id, r.score);
    }

    const scopes: MemoryScope[] = options?.projectName !== undefined ? ["project"] : ["global"];
    for (const scope of scopes) {
      const db = await getDb(scope);
      const projectFilter = options?.projectName !== undefined && scope === "project";

      const placeholders = Array.from(candidateIds).map(() => "?").join(",");
      const sql = `SELECT * FROM memory_nodes WHERE id IN (${placeholders}) AND (embedding IS NOT NULL OR embedding_blob IS NOT NULL) AND (expires_at IS NULL OR expires_at > ?) AND scope = ?${projectFilter ? " AND project_name = ?" : ""}`;
      const params: (string | number)[] = [...Array.from(candidateIds), Date.now(), scope];
      if (projectFilter) params.push(options!.projectName!);
      const rows = db.query(sql).all(...params) as SqliteNode[];

      for (const row of rows) {
        const level = row.level as MemoryNodeLevel;

        const node = rowToNode(row);
        if (!node.embedding) continue;

        if (options?.minLevel !== undefined && level < options.minLevel) continue;
        if (options?.maxLevel !== undefined && level > options.maxLevel) continue;
        if (options?.minUsefulness !== undefined && (node.usefulnessScore ?? 0) < options.minUsefulness) continue;
        if (options?.categoryFilter !== undefined && node.category !== options.categoryFilter) continue;
        if (options?.typeFilter !== undefined && node.type !== options.typeFilter) continue;
        if (options?.domainFilter !== undefined && node.domain !== options.domainFilter) continue;
        if (!matchesTagsFilter(node.tags, options?.tagsFilter)) continue;

        let _embedding = node.embedding;
        if (row.embedding_blob) {
          _embedding = blobToEmbedding(row.embedding_blob);
        }

        const semanticScore = hnswScoreMap.get(node.id) ?? 0;

        candidates.push({ node, semanticScore });
      }
    }
  }

  if (candidates.length === 0) {
    fallbackCount++;
    if (!fallbackLogged || fallbackCount % 20 === 0) {
      memLog("warn", "search", "HNSW returned no candidates — falling back to insertion-order pool", {
        fallbackCount,
        hnswSize: hnsw.getStats().globalNodes + hnsw.getStats().projectNodes,
        queryLen: query.length,
      });
      fallbackLogged = true;
    }
    const minLevel = options?.minLevel ?? 0;
    const maxLevel = options?.maxLevel ?? 5;
    const minUsefulness = options?.minUsefulness ?? 0;

    const scopes: MemoryScope[] = options?.projectName !== undefined ? ["project"] : ["global"];
    for (const scope of scopes) {
      const db = await getDb(scope);
      const projectFilter = options?.projectName !== undefined && scope === "project";
      const sql = `SELECT * FROM memory_nodes WHERE (embedding IS NOT NULL OR embedding_blob IS NOT NULL) AND level >= ? AND level <= ? AND usefulness_score >= ? AND (expires_at IS NULL OR expires_at > ?) AND scope = ?${projectFilter ? " AND project_name = ?" : ""} LIMIT ?`;
      const params: (number | string)[] = [minLevel, maxLevel, minUsefulness, Date.now(), scope];
      if (projectFilter) params.push(options!.projectName!);
      params.push(limit * 5);
      const rows = db.query(sql).all(...params) as SqliteNode[];

      for (const row of rows) {
        const node = rowToNode(row);
        if (!node.embedding) continue;

        let embedding = node.embedding;
        if (row.embedding_blob) {
          embedding = blobToEmbedding(row.embedding_blob);
        }

        if (options?.categoryFilter !== undefined && node.category !== options.categoryFilter) continue;
        if (options?.typeFilter !== undefined && node.type !== options.typeFilter) continue;
        if (options?.domainFilter !== undefined && node.domain !== options.domainFilter) continue;
        if (!matchesTagsFilter(node.tags, options?.tagsFilter)) continue;

        const semanticScore = Math.max(
          cosineSimilarity(query, embedding),
          ...(node.embeddingSegments ?? []).map(seg => cosineSimilarity(query, seg)),
        );

        candidates.push({ node, semanticScore });
      }
    }
  }

  if (queryText) {
    const queryTerms = tokenize(queryText);
    const bm25Scores = new Map<string, number>();

    // Dual retrieval: compute BM25 across ALL scope nodes, not just HNSW candidates
    // This catches keyword matches outside the vector neighborhood
    const existingIds = new Set(candidates.map(c => c.node.id));
    const scopes: MemoryScope[] = options?.projectName !== undefined ? ["project"] : ["global"];

    for (const scope of scopes) {
      const db = await getDb(scope);

      // Get all non-expired node IDs for this scope
      const projectFilter = options?.projectName !== undefined && scope === "project";
      let idSql = "SELECT id FROM memory_nodes WHERE (expires_at IS NULL OR expires_at > ?) AND scope = ?";
      if (projectFilter) idSql += " AND project_name = ?";
      const idParams: (string | number)[] = [Date.now(), scope];
      if (projectFilter) idParams.push(options!.projectName!);
      const allRows = db.query(idSql).all(...idParams) as { id: string }[];
      const allNodeIds = allRows.map(r => r.id);

      if (allNodeIds.length === 0) continue;

      // Compute BM25 scores for all scope nodes
      const scopeScores = computeBM25ScoresSQL(db, scope, queryTerms, allNodeIds);
      for (const [id, score] of scopeScores) {
        bm25Scores.set(id, score);
      }

      // Attach BM25 scores to candidates already in the pool
      for (const c of candidates) {
        const bs = bm25Scores.get(c.node.id);
        if (bs !== undefined && (c.bm25Score ?? 0) < bs) c.bm25Score = bs;
      }

      // Fetch BM25-only candidates (not already in HNSW results) and add to pool
      const bm25OnlyIds = allNodeIds
        .filter(id => !existingIds.has(id) && bm25Scores.has(id) && (bm25Scores.get(id) ?? 0) > 0)
        .sort((a, b) => (bm25Scores.get(b) ?? 0) - (bm25Scores.get(a) ?? 0))
        .slice(0, limit * 3);

      if (bm25OnlyIds.length > 0) {
        const placeholders = bm25OnlyIds.map(() => "?").join(",");
        const bm25Sql = `SELECT * FROM memory_nodes WHERE id IN (${placeholders}) AND (expires_at IS NULL OR expires_at > ?) AND scope = ?`;
        const bm25Rows = db.query(bm25Sql).all(...bm25OnlyIds, Date.now(), scope) as SqliteNode[];

        for (const row of bm25Rows) {
          const node = rowToNode(row);
          const level = row.level as MemoryNodeLevel;
          if (options?.minLevel !== undefined && level < options.minLevel) continue;
          if (options?.maxLevel !== undefined && level > options.maxLevel) continue;
          if (options?.minUsefulness !== undefined && (node.usefulnessScore ?? 0) < options.minUsefulness) continue;
          if (options?.categoryFilter !== undefined && node.category !== options.categoryFilter) continue;
          if (options?.typeFilter !== undefined && node.type !== options.typeFilter) continue;
          if (options?.domainFilter !== undefined && node.domain !== options.domainFilter) continue;
          if (!matchesTagsFilter(node.tags, options?.tagsFilter)) continue;

          candidates.push({ node, semanticScore: 0, bm25Score: bm25Scores.get(node.id) ?? 0 });
          existingIds.add(node.id);
        }
      }
    }
  }

  // Unified scoring: feature-weighted linear model, recency tiebreak only
  let finalNodes = toRankedNodes(rankCandidates(candidates, {
    weights,
    levelWeights: options?.levelWeights,
    intent: options?.intent,
  }));

  // Multi-hop temporal expansion: expand top candidates along temporal edges with score decay
  const temporalHops = options?.temporalBoost?.boostFactor !== undefined ? 1 : (options?.temporalHops ?? 0);
  if (temporalHops > 0 && finalNodes.length > 0) {
    const topK = Math.min(5, finalNodes.length);
    const seeds = finalNodes.slice(0, topK).map(n => n.id);
    const maxScore = Math.max(...finalNodes.map(n => n.importance ?? 0.5), 1);

    // Expand along temporal edges up to temporalHops hops
    const expandedIds = new Set<string>();
    for (const seedId of seeds) {
      await expandTemporalEdges(getDb, seedId, temporalHops, expandedIds);
    }

    // Assign decaying scores to expanded nodes
    const hopScores = new Map<string, number>();
    for (const seedId of seeds) {
      const seedScore = (finalNodes.find(n => n.id === seedId)?.importance ?? 0.5) / maxScore;
      await assignTemporalHopScores(getDb, seedId, seedScore, 0, temporalHops, new Set(), hopScores);
    }

    // Add expanded nodes not already in finalNodes
    const existingIds = new Set(finalNodes.map(n => n.id));
    const allScope: MemoryScope[] = options?.projectName !== undefined ? ["project"] : ["global"];
    for (const scope of allScope) {
      const db = await getDb(scope);
      const toFetch = [...expandedIds].filter(id => !existingIds.has(id));
      if (toFetch.length === 0) continue;
      const placeholders = toFetch.map(() => "?").join(",");
      const rows = db.query(`SELECT * FROM memory_nodes WHERE id IN (${placeholders}) AND scope = ?`).all(...toFetch, scope) as SqliteNode[];
      for (const row of rows) {
        const node = rowToNode(row);
        const hopScore = hopScores.get(node.id) ?? 0;
        existingIds.add(node.id);
        finalNodes.push({ ...node, importance: hopScore });
      }
    }

    // Apply hop scores to all expanded nodes
    for (const node of finalNodes) {
      const hopScore = hopScores.get(node.id);
      if (hopScore !== undefined) {
        node.importance = Math.max(node.importance ?? 0, hopScore);
      }
    }

    finalNodes.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  }

  finalNodes.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));

  // Deduplicate: scope iteration may return the same nodes from both 'global' and 'project' scopes
  const dedupedFinalNodes: MemoryNode[] = [];
  const seenIds = new Set<string>();
  for (const node of finalNodes) {
    if (!seenIds.has(node.id)) {
      seenIds.add(node.id);
      dedupedFinalNodes.push(node);
    }
  }

  let finalResults = dedupedFinalNodes.slice(0, limit);
  if (doRerank && queryText.length > 0 && dedupedFinalNodes.length > 3) {
    const mode: RerankMode = options?.rerankMode ?? "keyword";
    finalResults = await rerank({ mode, query: queryText, candidates: dedupedFinalNodes, topK: limit });
  }

  return finalResults;
}

export async function getDrilldownPath(
  getNode: (id: string) => Promise<MemoryNode>,
  nodeId: string,
  maxDepth: number
): Promise<MemoryNode[]> {
  const path: MemoryNode[] = [];
  let currentId: string | null = nodeId;
  let depth = 0;
  const visited = new Set<string>();

  while (currentId && depth < maxDepth) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    try {
      const node = await getNode(currentId);
      path.push(node);
      if (!node.parentIds || node.parentIds.length === 0) break;
      currentId = node.parentIds[0] ?? null;
      depth++;
    } catch {
      break;
    }
  }

  return path;
}

export async function drilldownQuery(
  deps: {
    getDb: (scope: MemoryScope) => Promise<Database>;
    searchByEmbedding: (query: number[], limit: number, options?: { minLevel?: MemoryNodeLevel | undefined; maxLevel?: MemoryNodeLevel | undefined; projectName?: string | undefined }) => Promise<MemoryNode[]>;
    getDrilldownPath: (nodeId: string, maxDepth: number) => Promise<MemoryNode[]>;
  },
  query: string,
  maxResults: number = 20,
  projectName?: string
): Promise<Array<{ node: MemoryNode; relevance: number; path: MemoryNode[]; level: "summary" | "intermediate" | "detail" }>> {
  const queryEmbedding = await generateEmbedding(query);

  const results: Array<{ node: MemoryNode; relevance: number; path: MemoryNode[]; level: "summary" | "intermediate" | "detail" }> = [];
  const seenIds = new Set<string>();

  // Relevance is the calibrated pipeline importance (query-relevant, NOT stored
  // importance). Level banding is a filter, not a score multiplier — the old
  // ×0.8/×0.6 leg weights silently ranked high-importance L1 nodes above any
  // query relevance (the "same 3 nodes every time" injection bug).
  const summaries = await deps.searchByEmbedding(queryEmbedding, 5, { minLevel: 2, maxLevel: 4, projectName });
  for (const node of summaries) {
    if (seenIds.has(node.id)) continue;
    seenIds.add(node.id);

    const path = await deps.getDrilldownPath(node.id, 3);
    results.push({
      node,
      relevance: node.importance ?? 0,
      path,
      level: "summary",
    });
  }

  const intermediates = await deps.searchByEmbedding(queryEmbedding, 10, { minLevel: 1, maxLevel: 1, projectName });
  for (const node of intermediates) {
    if (seenIds.has(node.id)) continue;
    if (results.length >= maxResults) break;
    seenIds.add(node.id);

    const path = await deps.getDrilldownPath(node.id, 2);
    results.push({
      node,
      relevance: node.importance ?? 0,
      path,
      level: "intermediate",
    });
  }

  const details = await deps.searchByEmbedding(queryEmbedding, maxResults, { minLevel: 0, maxLevel: 0, projectName });
  for (const node of details) {
    if (seenIds.has(node.id)) continue;
    if (results.length >= maxResults) break;
    seenIds.add(node.id);

    results.push({
      node,
      relevance: node.importance ?? 0,
      path: [node],
      level: "detail",
    });
  }

  if (results.length < maxResults) {
    const textScopes: MemoryScope[] = projectName !== undefined ? ["project"] : ["global"];
    for (const scope of textScopes) {
      const db = await deps.getDb(scope);
      const projectFilter = projectName !== undefined && scope === "project";
      const sql = `SELECT * FROM memory_nodes WHERE (label LIKE ? OR content LIKE ?) AND (embedding IS NULL AND embedding_blob IS NULL) AND scope = ?${projectFilter ? " AND project_name = ?" : ""}`;
      const params: (string | number)[] = [`%${query}%`, `%${query}%`, scope];
      if (projectFilter) params.push(projectName);
      const rows = db.query(sql).all(...params) as SqliteNode[];
      for (const row of rows) {
        if (results.length >= maxResults) break;
        const node = rowToNode(row);
        if (seenIds.has(node.id)) continue;
        seenIds.add(node.id);
        results.push({
          node,
          relevance: 0.5,
          path: [node],
          level: "detail",
        });
      }
      if (results.length >= maxResults) break;
    }
  }

  return results.sort((a, b) => b.relevance - a.relevance).slice(0, maxResults);
}

export async function detectTopicBoundaries(
  getDb: (scope: MemoryScope) => Promise<Database>,
  scope: MemoryScope | "all",
  minSimilarity: number = 0.7,
  projectName?: string
): Promise<MemoryNode[][]> {
  const scopes: MemoryScope[] = scope === "all"
    ? (projectName !== undefined ? ["project"] : ["global"])
    : [scope];
  const nodesWithEmbeddings: MemoryNode[] = [];

  for (const s of scopes) {
    const db = await getDb(s);
    const projectFilter = projectName !== undefined && s === "project";
    const sql = `SELECT * FROM memory_nodes WHERE (embedding IS NOT NULL OR embedding_blob IS NOT NULL) AND length(content) > 50${projectFilter ? " AND project_name = ?" : ""} ORDER BY created_at DESC`;
    const params: string[] = projectFilter ? [projectName] : [];
    const rows = db.query(sql).all(...params) as SqliteNode[];
    for (const row of rows) {
      nodesWithEmbeddings.push(rowToNode(row));
    }
  }

  if (nodesWithEmbeddings.length < 2) return [];

  const sorted = nodesWithEmbeddings;

  const boundaries: MemoryNode[][] = [];
  let currentCluster: MemoryNode[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;

    if (!prev.embedding || !curr.embedding) continue;

    const similarity = cosineSimilarity(prev.embedding, curr.embedding);

    if (similarity >= minSimilarity) {
      currentCluster.push(curr);
    } else {
      if (currentCluster.length >= 2) {
        boundaries.push(currentCluster);
      }
      currentCluster = [curr];
    }
  }

  if (currentCluster.length >= 2) {
    boundaries.push(currentCluster);
  }

  return boundaries;
}
