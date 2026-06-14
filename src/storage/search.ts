import { Database } from "bun:sqlite";
import type { MemoryScope, MemoryNode, MemoryNodeLevel, MemoryNodeType, MemoryCategory } from "./types";
import type { SqliteNode } from "./queries/base";
import { rowToNode } from "./queries/base";
import { getHNSWIndex } from "../hnsw-index";
import { generateEmbedding } from "../embeddings";
import { cosineSimilarity } from "../math";
import { computeBM25ScoresSQL, computeFinalScores, rerankResults } from "./queries/search-helpers";
import { tokenize, blobToEmbedding, withRetry } from "./utils";

export async function searchByEmbedding(
  getDb: (scope: MemoryScope) => Promise<Database>,
  query: number[],
  limit: number = 5,
  options?: {
    minLevel?: MemoryNodeLevel;
    maxLevel?: MemoryNodeLevel;
    levelWeights?: Partial<Record<MemoryNodeLevel, number>>;
    bm25Weight?: number;
    queryText?: string;
    minUsefulness?: number;
    rerank?: boolean;
    bm25Scores?: Map<string, number>;
    projectName?: string;
    temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number };
    categoryFilter?: MemoryCategory;
  }
): Promise<MemoryNode[]> {
  const weights = options?.levelWeights ?? {};
  const bm25Weight = options?.bm25Weight ?? 0;
  const doRerank = options?.rerank ?? false;
  const queryText = options?.queryText ?? "";

  const hnsw = getHNSWIndex();
  const hnswResults = await hnsw.search(query, limit * 5);

  let scoredNodes: MemoryNode[] = [];

  if (hnswResults.length > 0) {
    const candidateIds = new Set(hnswResults.map(r => r.id));
    const hnswScoreMap = new Map(hnswResults.map(r => [r.id, r.score]));

    const scopes: MemoryScope[] = options?.projectName !== undefined ? ["project"] : ["global", "project"];
    for (const scope of scopes) {
      const db = await getDb(scope);
      const projectFilter = options?.projectName !== undefined && scope === "project";

      const placeholders = Array.from(candidateIds).map(() => "?").join(",");
      const sql = `SELECT * FROM memory_nodes WHERE id IN (${placeholders}) AND (embedding IS NOT NULL OR embedding_blob IS NOT NULL) AND (expires_at IS NULL OR expires_at > ?)${projectFilter ? " AND project_name = ?" : ""}`;
      const params: (string | number)[] = [...Array.from(candidateIds), Date.now()];
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

        let embedding = node.embedding;
        if (row.embedding_blob) {
          embedding = blobToEmbedding(row.embedding_blob);
        }

        const hnswScore = hnswScoreMap.get(node.id) ?? 0;

        const levelWeight = weights[level] ?? 1;
        const confidence = node.confidence ?? 0.5;
        const confidenceWeight = 0.5 + 0.5 * confidence;
        const categoryWeight = node.category === "episodic" ? 0.5 : 1.0;

        scoredNodes.push({
          ...node,
          importance: hnswScore * levelWeight * confidenceWeight * categoryWeight * (1 + (node.usefulnessScore ?? 0) * 0.1),
        });
      }
    }
  }

  if (scoredNodes.length === 0) {
    const minLevel = options?.minLevel ?? 0;
    const maxLevel = options?.maxLevel ?? 5;
    const minUsefulness = options?.minUsefulness ?? 0;

    const scopes: MemoryScope[] = options?.projectName !== undefined ? ["project"] : ["global", "project"];
    for (const scope of scopes) {
      const db = await getDb(scope);
      const projectFilter = options?.projectName !== undefined && scope === "project";
      const sql = `SELECT * FROM memory_nodes WHERE (embedding IS NOT NULL OR embedding_blob IS NOT NULL) AND level >= ? AND level <= ? AND usefulness_score >= ? AND (expires_at IS NULL OR expires_at > ?)${projectFilter ? " AND project_name = ?" : ""} LIMIT ?`;
      const params: (number | string)[] = [minLevel, maxLevel, minUsefulness, Date.now()];
      if (projectFilter) params.push(options!.projectName!);
      params.push(limit * 5);
      const rows = db.query(sql).all(...params) as SqliteNode[];

      for (const row of rows) {
        const level = row.level as MemoryNodeLevel;

        const node = rowToNode(row);
        if (!node.embedding) continue;

        let embedding = node.embedding;
        if (row.embedding_blob) {
          embedding = blobToEmbedding(row.embedding_blob);
        }

        if (options?.categoryFilter !== undefined && node.category !== options.categoryFilter) continue;

        const semanticScore = cosineSimilarity(query, embedding);
        const levelWeight = weights[level] ?? 1;
        const confidence = node.confidence ?? 0.5;
        const confidenceWeight = 0.5 + 0.5 * confidence;
        const categoryWeight = node.category === "episodic" ? 0.5 : 1.0;

        scoredNodes.push({
          ...node,
          importance: semanticScore * levelWeight * confidenceWeight * categoryWeight * (1 + (node.usefulnessScore ?? 0) * 0.1),
        });
      }
    }
  }

  if (bm25Weight > 0 && queryText) {
    const queryTerms = tokenize(queryText);
    const bm25Scores = new Map<string, number>();
    for (const scope of ["global", "project"] as MemoryScope[]) {
      const db = await getDb(scope);
      const scopeNodeIds = scoredNodes.filter(n => n.scope === scope).map(n => n.id);
      if (scopeNodeIds.length === 0) continue;
      const scopeScores = computeBM25ScoresSQL(db, scope, queryTerms, scopeNodeIds);
      for (const [id, score] of scopeScores) {
        bm25Scores.set(id, score);
      }
    }
    options = { ...options, bm25Scores };
  }

  const finalNodes = computeFinalScores(scoredNodes, options);

  // Temporal boost: if temporalBoost is specified, boost nodes temporally connected to the given node IDs
  if (options?.temporalBoost && finalNodes.length > 0) {
    const boost = options.temporalBoost;
    const factor = boost.boostFactor ?? 1.3;
    const boostIds = new Set(boost.nodeIds);
    const edgeTypeFilter = boost.edgeType;

    // Query all edges connected to boost nodes in one query
    const projectDb = await getDb("project");
    let edgeSql = "SELECT source_node_id, target_node_id FROM temporal_edges WHERE (source_node_id IN (";
    edgeSql += boost.nodeIds.map(() => "?").join(",");
    edgeSql += ") OR target_node_id IN (";
    edgeSql += boost.nodeIds.map(() => "?").join(",");
    edgeSql += "))";
    if (edgeTypeFilter) {
      edgeSql += " AND edge_type = ?";
    }
    const edgeParams = [...boost.nodeIds, ...boost.nodeIds];
    if (edgeTypeFilter) edgeParams.push(edgeTypeFilter);
    const edgeRows = projectDb.query(edgeSql).all(...edgeParams) as { source_node_id: string; target_node_id: string }[];

    // Build set of node IDs that are temporally connected to any boost node
    const tempConnected = new Set<string>();
    for (const row of edgeRows) {
      if (boostIds.has(row.source_node_id)) tempConnected.add(row.target_node_id);
      if (boostIds.has(row.target_node_id)) tempConnected.add(row.source_node_id);
    }

    // Apply boost
    for (const node of finalNodes) {
      if (tempConnected.has(node.id)) {
        node.importance = (node.importance ?? 0.5) * factor;
      }
    }

    // Re-sort
    finalNodes.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  }

  let finalResults = finalNodes.slice(0, limit);
  if (doRerank && queryText.length > 0 && finalResults.length > 3) {
    const reranked = rerankResults(queryText, finalResults, limit);
    finalResults = reranked.map(r => ({
      ...r.node,
      importance: r.finalScore
    }));
  }

  const now = Date.now();
  for (const node of finalResults) {
    const db = await getDb(node.scope as MemoryScope);
    db.run(`UPDATE memory_nodes SET times_used = times_used + 1, last_accessed = ? WHERE id = ?`, [now, node.id]);
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
    searchByEmbedding: (query: number[], limit: number, options?: any) => Promise<MemoryNode[]>;
    getDrilldownPath: (nodeId: string, maxDepth: number) => Promise<MemoryNode[]>;
  },
  query: string,
  maxResults: number = 20,
  projectName?: string
): Promise<Array<{ node: MemoryNode; relevance: number; path: MemoryNode[]; level: "summary" | "intermediate" | "detail" }>> {
  const queryEmbedding = await generateEmbedding(query);

  const results: Array<{ node: MemoryNode; relevance: number; path: MemoryNode[]; level: "summary" | "intermediate" | "detail" }> = [];
  const seenIds = new Set<string>();

  const summaries = await deps.searchByEmbedding(queryEmbedding, 5, { minLevel: 2, maxLevel: 4, projectName });
  for (const node of summaries) {
    if (seenIds.has(node.id)) continue;
    seenIds.add(node.id);

    const path = await deps.getDrilldownPath(node.id, 3);
    results.push({
      node,
      relevance: node.importance,
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
      relevance: node.importance * 0.8,
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
      relevance: node.importance * 0.6,
      path: [node],
      level: "detail",
    });
  }

  if (results.length < maxResults) {
    const textScopes: MemoryScope[] = projectName !== undefined ? ["project"] : ["global", "project"];
    for (const scope of textScopes) {
      const db = await deps.getDb(scope);
      const projectFilter = projectName !== undefined && scope === "project";
      const sql = `SELECT * FROM memory_nodes WHERE (label LIKE ? OR content LIKE ?) AND (embedding IS NULL AND embedding_blob IS NULL)${projectFilter ? " AND project_name = ?" : ""}`;
      const params: (string | number)[] = [`%${query}%`, `%${query}%`];
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
    ? (projectName !== undefined ? ["project"] : ["global", "project"])
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
