import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { SqliteNode } from "./base";
import { blobToEmbedding, embeddingToBlob, rowToNode } from "./base";
import type { MemoryScope, MemoryNodeLevel, MemoryNodeType, MemoryNode, CreateNodeInput } from "../types";
import { getHNSWIndex } from "../../hnsw-index";

function validateLabel(label: string): string {
  const trimmed = label.trim();
  if (!/^[a-z0-9][a-z0-9-_:]{1,60}$/i.test(trimmed)) {
    throw new Error(
      `Invalid label "${label}". Use letters/numbers/dash/underscore/colon (2-61 chars).`,
    );
  }
  return trimmed;
}

export async function queryListNodes(
  db: Database,
  scope: MemoryScope,
  level?: MemoryNodeLevel,
  limit = 50,
  offset = 0,
  includeExpired = false
): Promise<MemoryNode[]> {
  let query = "SELECT * FROM memory_nodes";
  const params: (string | number)[] = [];
  
  const conditions: string[] = [];
  conditions.push("scope = ?");
  params.push(scope);
  
  if (level !== undefined) {
    conditions.push("level = ?");
    params.push(level);
  }

  if (!includeExpired) {
    conditions.push("(expires_at IS NULL OR expires_at > ?)");
    params.push(Date.now());
  }
  
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  
  query += " ORDER BY importance DESC, created_at DESC";
  query += " LIMIT ? OFFSET ?";
  params.push(limit, offset);
  
  const rows = db.query(query).all(...params) as SqliteNode[];
  return rows.map(rowToNode);
}

export async function queryGetNode(db: Database, id: string): Promise<MemoryNode | null> {
  const row = db.query("SELECT * FROM memory_nodes WHERE id = ?").get(id) as SqliteNode | null;
  if (!row) return null;
  return rowToNode(row);
}

export async function queryGetNodeByLabel(db: Database, scope: MemoryScope, label: string, includeExpired = false): Promise<{ id: string } | null> {
  const safeLabel = validateLabel(label);
  const sql = includeExpired
    ? "SELECT id FROM memory_nodes WHERE label = ? AND scope = ?"
    : "SELECT id FROM memory_nodes WHERE label = ? AND scope = ? AND (expires_at IS NULL OR expires_at > ?)";
  const params: (string | number)[] = includeExpired ? [safeLabel, scope] : [safeLabel, scope, Date.now()];
  const row = db.query(sql).get(...params) as { id: string } | null;
  return row;
}

export async function queryGetNodeByLabelFull(db: Database, scope: MemoryScope, label: string, includeExpired = false): Promise<MemoryNode> {
  const safeLabel = validateLabel(label);
  const sql = includeExpired
    ? "SELECT * FROM memory_nodes WHERE label = ? AND scope = ?"
    : "SELECT * FROM memory_nodes WHERE label = ? AND scope = ? AND (expires_at IS NULL OR expires_at > ?)";
  const params: (string | number)[] = includeExpired ? [safeLabel, scope] : [safeLabel, scope, Date.now()];
  const row = db.query(sql).get(...params) as SqliteNode | null;

  if (!row) {
    throw new Error(`Memory node not found: ${scope}:${safeLabel}`);
  }

  db.run("UPDATE memory_nodes SET access_count = access_count + 1, last_accessed = ? WHERE id = ?", [Date.now(), row.id]);
  return { ...rowToNode(row), accessCount: row.access_count + 1 };
}

export async function queryGetNodeByPrefix(db: Database, prefix: string): Promise<MemoryNode | null> {
  const rows = db.query("SELECT * FROM memory_nodes WHERE id LIKE ?").all(`${prefix}%`) as SqliteNode[];
  
  if (rows.length === 1) {
    const row = rows[0]!;
    db.run("UPDATE memory_nodes SET access_count = access_count + 1, last_accessed = ? WHERE id = ?", [Date.now(), row.id]);
    return rowToNode(row);
  }
  
  if (rows.length > 1) {
    throw new Error(`Ambiguous ID prefix "${prefix}" matches ${rows.length} nodes. Use full ID.`);
  }
  return null;
}

export async function queryCreateNode(
  db: Database,
  node: CreateNodeInput,
  storeLinks: (scope: MemoryScope, id: string, content: string) => Promise<void>,
  updateLinksForNewNode: (scope: MemoryScope, label: string, id: string) => Promise<void>,
  updateBM25Index: (db: Database, id: string, content: string, label: string | undefined, scope: MemoryScope) => void
): Promise<MemoryNode> {
  const now = Date.now();
  const id = randomUUID();
  const sticky = node.type === "skill" ? 1 : (node.sticky ? 1 : 0);
  const ttlDays = node.ttlDays ?? null;
  const expiresAt = ttlDays ? now + ttlDays * 86400000 : null;
  const confidence = node.confidence ?? 0.5;
  const usefulnessScore = node.usefulnessScore ?? 0;
  const timesUsed = node.timesUsed ?? 0;
  const timesHelpful = node.timesHelpful ?? 0;

  db.run(
    "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, ttl_days, expires_at, confidence, usefulness_score, times_used, times_helpful) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      node.scope,
      node.label ?? "",
      node.content,
      node.summary ?? null,
      node.level ?? 0,
      node.parentIds ? JSON.stringify(node.parentIds) : null,
      node.embedding ? JSON.stringify(node.embedding) : null,
      node.embedding ? embeddingToBlob(node.embedding) : null,
      now,
      now,
      node.importance ?? 0.5,
      0,
      null,
      node.type ?? null,
      node.metadata ? JSON.stringify(node.metadata) : null,
      sticky,
      ttlDays,
      expiresAt,
      confidence,
      usefulnessScore,
      timesUsed,
      timesHelpful,
    ],
  );

  // Store links
  await storeLinks(node.scope, id, node.content);
  if (node.label) {
    await updateLinksForNewNode(node.scope, node.label, id);
  }
  updateBM25Index(db, id, node.content, node.label, node.scope);

  // HNSW add is outside transaction (in-memory)
  if (node.embedding) {
    const hnsw = getHNSWIndex();
    await hnsw.addNode(node.scope, id, node.embedding);
  }

  return {
    id,
    scope: node.scope,
    label: node.label,
    content: node.content,
    summary: node.summary ?? null,
    level: node.level ?? 0,
    parentIds: node.parentIds ?? null,
    embedding: node.embedding ?? null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    importance: node.importance ?? 0.5,
    accessCount: 0,
    lastAccessed: null,
    type: node.type ?? null,
    metadata: node.metadata ?? null,
    sticky: Boolean(sticky),
    ttlDays,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    confidence: node.confidence ?? 0.5,
    lastVerified: null,
    usefulnessScore: node.usefulnessScore ?? 0,
    timesUsed: node.timesUsed ?? 0,
    timesHelpful: node.timesHelpful ?? 0,
  };
}

type FieldMapping = (value: unknown) => [string, (string | number | Buffer | null)][];

const UPDATE_FIELDS: Record<string, FieldMapping> = {
  content: (v) => [["content = ?", v as string]],
  summary: (v) => [["summary = ?", v as string | null]],
  level: (v) => [["level = ?", v as number]],
  parentIds: (v) => [["parent_ids = ?", v ? JSON.stringify(v) : null]],
  importance: (v) => [["importance = ?", v as number]],
  type: (v) => [["type = ?", v as string | null]],
  metadata: (v) => [["metadata = ?", v ? JSON.stringify(v) : null]],
  embedding: (v) => [
    ["embedding = ?", v ? JSON.stringify(v) : null],
    ["embedding_blob = ?", v ? embeddingToBlob(v as number[]) : null],
  ],
  sticky: (v) => [["sticky = ?", v ? 1 : 0]],
  ttlDays: (v) => {
    const now = Date.now();
    return [
      ["ttl_days = ?", v as number | null],
      ["expires_at = ?", v ? now + (v as number) * 86400000 : null],
    ];
  },
  confidence: (v) => [["confidence = ?", v as number]],
  usefulnessScore: (v) => [["usefulness_score = ?", v as number]],
  timesHelpful: (v) => [["times_helpful = ?", v as number]],
};

export async function queryUpdateNode(
  db: Database,
  id: string,
  updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "metadata" | "embedding" | "sticky" | "ttlDays" | "confidence" | "usefulnessScore" | "timesHelpful">>
): Promise<void> {
  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number | Buffer | null)[] = [Date.now()];

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const field = UPDATE_FIELDS[key];
    if (!field) continue;
    for (const [clause, param] of field(value)) {
      setClauses.push(clause);
      params.push(param);
    }
  }

  params.push(id);
  db.run(
    `UPDATE memory_nodes SET ${setClauses.join(", ")} WHERE id = ?`,
    params as (string | number | Buffer | null)[],
  );
}

export async function queryDeleteNode(db: Database, id: string): Promise<void> {
  db.run("DELETE FROM memory_nodes WHERE id = ?", [id]);
}