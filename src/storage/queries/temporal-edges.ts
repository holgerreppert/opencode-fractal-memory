import { Database } from "bun:sqlite";

export type TemporalEdgeDirection = "outgoing" | "incoming" | "both";

export type TemporalEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  scope: string;
  createdAt: number;
  confidence: number;
  metadata: Record<string, unknown> | null;
};

export function queryCreateTemporalEdge(
  db: Database,
  edge: {
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: string;
    scope?: string;
    confidence?: number;
    metadata?: Record<string, unknown> | null;
  },
): TemporalEdge {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO temporal_edges (id, source_node_id, target_node_id, edge_type, scope, created_at, confidence, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      edge.sourceNodeId,
      edge.targetNodeId,
      edge.edgeType,
      edge.scope ?? "project",
      now,
      edge.confidence ?? 1.0,
      edge.metadata ? JSON.stringify(edge.metadata) : null,
    ],
  );
  return {
    id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    edgeType: edge.edgeType,
    scope: edge.scope ?? "project",
    createdAt: now,
    confidence: edge.confidence ?? 1.0,
    metadata: edge.metadata ?? null,
  };
}

export function queryGetTemporalEdges(
  db: Database,
  nodeId: string,
  direction: TemporalEdgeDirection = "both",
  edgeType?: string,
): TemporalEdge[] {
  let sql: string;
  const params: string[] = [];

  if (direction === "outgoing") {
    sql = "SELECT * FROM temporal_edges WHERE source_node_id = ?";
    params.push(nodeId);
  } else if (direction === "incoming") {
    sql = "SELECT * FROM temporal_edges WHERE target_node_id = ?";
    params.push(nodeId);
  } else {
    sql = "SELECT * FROM temporal_edges WHERE source_node_id = ? OR target_node_id = ?";
    params.push(nodeId, nodeId);
  }

  if (edgeType) {
    sql += " AND edge_type = ?";
    params.push(edgeType);
  }

  sql += " ORDER BY created_at ASC";

  const rows = db.query(sql).all(...params) as Array<{
    id: string;
    source_node_id: string;
    target_node_id: string;
    edge_type: string;
    scope: string;
    created_at: number;
    confidence: number;
    metadata: string | null;
  }>;

  return rows.map(r => ({
    id: r.id,
    sourceNodeId: r.source_node_id,
    targetNodeId: r.target_node_id,
    edgeType: r.edge_type,
    scope: r.scope,
    createdAt: r.created_at,
    confidence: r.confidence,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));
}

export function queryExpandWithTemporalEdges(
  db: Database,
  nodeIds: string[],
  maxHops: number = 1,
  edgeType?: string,
): Map<string, { nodeId: string; hops: number }> {
  const visited = new Map<string, { nodeId: string; hops: number }>();
  const queue: Array<{ nodeId: string; hops: number }> = nodeIds.map(id => ({ nodeId: id, hops: 0 }));

  for (const item of queue) {
    visited.set(item.nodeId, item);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hops >= maxHops) continue;

    const edges = queryGetTemporalEdges(db, current.nodeId, "both", edgeType);
    for (const edge of edges) {
      const neighborId = edge.sourceNodeId === current.nodeId ? edge.targetNodeId : edge.sourceNodeId;
      if (!visited.has(neighborId)) {
        const item = { nodeId: neighborId, hops: current.hops + 1 };
        visited.set(neighborId, item);
        queue.push(item);
      }
    }
  }

  return visited;
}

export function queryDeleteTemporalEdgesForNode(db: Database, nodeId: string): void {
  db.run("DELETE FROM temporal_edges WHERE source_node_id = ? OR target_node_id = ?", [nodeId, nodeId]);
}
