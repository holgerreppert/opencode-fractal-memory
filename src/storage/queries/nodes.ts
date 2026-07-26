import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { SqliteNode } from "./base";
import { embeddingToBlob, rowToNode } from "./base";
import type { MemoryScope, MemoryNodeLevel, MemoryNode, MemoryCategory, MemorySupertype, MemoryDomain, CreateNodeInput } from "../types";
import { getHNSWIndex } from "../../infrastructure/vector/hnsw-index";
import { z } from "zod";

const CreateNodeSchema = z.object({
  scope: z.enum(["global", "project"]),
  label: z.string().optional(),
  content: z.string(),
  summary: z.string().nullable().optional(),
  level: z.number().int().min(0).max(5).optional(),
  parentIds: z.array(z.string()).nullable().optional(),
  embedding: z.array(z.number()).nullable().optional(),
  importance: z.number().min(0).max(2).optional(),
  type: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  supertype: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  source: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  sticky: z.boolean().optional(),
  ttlDays: z.number().int().nullable().optional(),
  confidence: z.number().min(0).max(2).optional(),
  verificationCount: z.number().int().min(0).optional(),
  usefulnessScore: z.number().min(0).max(5).optional(),
  timesUsed: z.number().int().min(0).optional(),
  timesHelpful: z.number().int().min(0).optional(),
  domain: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
});

const TYPE_METADATA: Record<string, Record<string, unknown>> = {
  note:                { tags: ["auto-generated"], customType: "note" },
  summary:             { tags: ["compressed"] },
  lesson:              { tags: ["lesson-auto"] },
  plan:                { tags: ["auto-generated"], customType: "plan" },
  playbook:            { tags: ["playbook"] },
  event:               { tags: ["event"] },
  task:                { tags: ["task"] },
  research:            { tags: ["research"] },
  project:             { tags: ["project"] },
  implementation:      { tags: ["implementation"] },
  bug:                 { tags: ["bug"] },
  pref:                { tags: ["preference"] },
  howto:               { tags: ["howto"] },
  core:                { tags: ["core", "compressed"] },
  technical:           { tags: ["technical"] },
  session:             { tags: ["session"] },
  legal:               { tags: ["legal"] },
  knowledge:           { tags: ["knowledge"] },
  improvement:         { tags: ["improvement"] },
  decision:            { tags: ["decision"] },
  "best-practices":    { tags: ["best-practices"] },
  audit:               { tags: ["audit"] },
  architecture:        { tags: ["architecture"] },
  analysis:            { tags: ["analysis"] },
  "rule:mandatory":    { tags: ["rule", "mandatory"] },
  review:              { tags: ["review"] },
  "project-history":   { tags: ["project-history"] },
  preference:          { tags: ["preference"] },
  idea:                { tags: ["idea"] },
  fix:                 { tags: ["fix"] },
  fact:                { tags: ["fact"] },
  exploration:         { tags: ["exploration"] },
  "debug-investigation": { tags: ["debug"] },
  convention:          { tags: ["convention"] },
  config:              { tags: ["config"] },
  concept:             { tags: ["concept"] },
  skill:               { tags: ["skill"] },
};

const TYPE_CATEGORY: Record<string, MemoryCategory> = {
  event: "episodic",
  note: "episodic",
  session: "episodic",
  task: "episodic",
  plan: "episodic",
  exploration: "episodic",
  "debug-investigation": "episodic",
  improvement: "episodic",
  review: "episodic",
};

const TYPE_SUPERTYPE: Record<string, MemorySupertype> = {
  concept: "declarative",
  fact: "declarative",
  knowledge: "declarative",
  architecture: "declarative",
  convention: "declarative",
  research: "declarative",
  lesson: "procedural",
  howto: "procedural",
  skill: "procedural",
  playbook: "procedural",
  event: "experiential",
  note: "experiential",
  session: "experiential",
  task: "experiential",
  plan: "experiential",
  exploration: "experiential",
  "debug-investigation": "experiential",
  improvement: "experiential",
  review: "experiential",
  bug: "experiential",
  summary: "meta",
  core: "meta",
  fix: "meta",
};

const TYPE_DOMAIN: Record<string, MemoryDomain> = {
  architecture: "architecture",
  knowledge: "architecture",
  howto: "operations",
  config: "operations",
  technical: "operations",
  concept: "knowledge",
  fact: "knowledge",
  research: "knowledge",
  "rule:mandatory": "rules",
  "rule:standard": "rules",
  "rule:suggestion": "rules",
  convention: "rules",
  "best-practices": "rules",
  event: "history",
  note: "history",
  session: "history",
  task: "history",
  plan: "history",
  exploration: "history",
  "debug-investigation": "history",
  improvement: "history",
  review: "history",
  bug: "history",
  fix: "history",
  summary: "history",
  "project-history": "history",
  skill: "patterns",
  playbook: "patterns",
  lesson: "patterns",
  preference: "preferences",
  pref: "preferences",
};

function resolveNodeCategory(type: string | null | undefined): MemoryCategory | null {
  if (!type) return null;
  return TYPE_CATEGORY[type] ?? "semantic";
}

function resolveNodeSupertype(type: string | null | undefined): MemorySupertype | null {
  if (!type) return null;
  return TYPE_SUPERTYPE[type] ?? null;
}

function resolveNodeDomain(type: string | null | undefined): MemoryDomain {
  if (!type) return null;
  return TYPE_DOMAIN[type] ?? null;
}

function autoGenerateMetadata(type: string | null | undefined): Record<string, unknown> | null {
  if (!type) return { tags: ["untyped"] };
  return TYPE_METADATA[type] ?? { tags: [type] };
}

function validateLabel(label: string): string {
  const trimmed = label.trim();
  if (!/^[a-z0-9][a-z0-9-_:.]{1,60}$/i.test(trimmed)) {
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
  includeExpired = false,
  projectName?: string,
  category?: MemoryCategory
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

  if (projectName !== undefined) {
    conditions.push("project_name = ?");
    params.push(projectName);
  }

  if (category !== undefined) {
    conditions.push("category = ?");
    params.push(category);
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
  CreateNodeSchema.parse(node);
  const now = Date.now();
  const id = randomUUID();
  const sticky = node.type === "skill" ? 1 : (node.sticky ? 1 : 0);
  const resolvedCategory = node.category !== undefined ? node.category : resolveNodeCategory(node.type ?? null);
  const resolvedSupertype = node.supertype !== undefined ? node.supertype : resolveNodeSupertype(node.type ?? null);
  const resolvedDomain = node.domain !== undefined ? node.domain : resolveNodeDomain(node.type ?? null);
  const ttlDays = node.ttlDays ?? (resolvedCategory === "episodic" ? 30 : null);
  const expiresAt = ttlDays ? now + ttlDays * 86400000 : null;
  const confidence = node.confidence ?? 0.5;
  const usefulnessScore = node.usefulnessScore ?? 0;
  const timesUsed = node.timesUsed ?? 0;
  const timesHelpful = node.timesHelpful ?? 0;
  const resolvedMetadata = node.metadata ?? autoGenerateMetadata(node.type ?? null);
  const resolvedTags = node.tags !== undefined ? node.tags : (resolvedMetadata?.tags as string[] | undefined) ?? null;

  db.run(
    "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, category, supertype, domain, tags, source, metadata, sticky, ttl_days, expires_at, confidence, verification_count, usefulness_score, times_used, times_helpful, project_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      resolvedCategory,
resolvedSupertype,
      resolvedDomain,
      resolvedTags ? JSON.stringify(resolvedTags) : null,
      node.source ?? null,
      resolvedMetadata ? JSON.stringify(resolvedMetadata) : null,
      sticky,
      ttlDays,
      expiresAt,
      confidence,
      node.verificationCount ?? 0,
      usefulnessScore,
      timesUsed,
      timesHelpful,
      node.projectName ?? null,
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
    label: node.label ?? null,
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
    category: resolvedCategory,
    supertype: resolvedSupertype,
    domain: resolvedDomain,
    tags: resolvedTags,
    source: node.source ?? null,
    metadata: node.metadata ?? null,
    sticky: Boolean(sticky),
    ttlDays,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    confidence: node.confidence ?? 0.5,
    lastVerified: null,
    verificationCount: node.verificationCount ?? 0,
    usefulnessScore: node.usefulnessScore ?? 0,
    timesUsed: node.timesUsed ?? 0,
    timesHelpful: node.timesHelpful ?? 0,
    projectName: node.projectName ?? null,
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
  category: (v) => [["category = ?", v as string | null]],
  supertype: (v) => [["supertype = ?", v as string | null]],
  domain: (v) => [["domain = ?", v as string | null]],
  tags: (v) => [["tags = ?", v ? JSON.stringify(v) : null]],
  source: (v) => [["source = ?", v as string | null]],
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
  updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "category" | "supertype" | "domain" | "tags" | "source" | "metadata" | "embedding" | "sticky" | "ttlDays" | "confidence" | "verificationCount" | "usefulnessScore" | "timesHelpful">>
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

export function querySearchText(db: Database, scope: MemoryScope, query: string, limit: number, projectName?: string): MemoryNode[] {
  const lowerQuery = `%${query.toLowerCase()}%`;
  const hasProjectFilter = !!(projectName && scope === "project");
  const params: (string | number)[] = [scope, lowerQuery, lowerQuery];
  if (hasProjectFilter) params.push(projectName!);
  params.push(limit);
  const projectClause = hasProjectFilter ? "AND project_name = ?" : "";
  const rows = db.query(`
    SELECT id, scope, label, content, summary, level, parent_ids, embedding_blob, created_at, updated_at,
           importance, access_count, last_accessed, type, category, supertype, domain, tags, source, metadata, sticky, ttl_days, expires_at,
           confidence, last_verified, verification_count, usefulness_score, times_used, times_helpful, project_name
    FROM memory_nodes
    WHERE scope = ? AND (LOWER(label) LIKE ? OR LOWER(content) LIKE ?) ${projectClause}
    ORDER BY importance DESC
    LIMIT ?
  `).all(...params) as SqliteNode[];
  return rows.map(r => rowToNode(r));
}

export function querySearchBM25(db: Database, scope: MemoryScope, terms: string[], limit: number, projectName?: string): MemoryNode[] {
  const placeholders = terms.map(() => "?").join(",");
  const projectFilter = projectName && scope === "project" ? "AND n.project_name = ?" : "";
  const params: (string | number)[] = [...terms, scope];
  if (projectName && scope === "project") params.push(projectName);
  params.push(limit);
  const rows = db.query(`
    SELECT n.id, n.scope, n.label, n.content, n.summary, n.level, n.parent_ids, n.embedding_blob,
           n.created_at, n.updated_at, n.importance, n.access_count, n.last_accessed,
           n.type, n.category, n.supertype, n.domain, n.tags, n.source, n.metadata, n.sticky, n.ttl_days, n.expires_at,
           n.confidence, n.last_verified, n.verification_count, n.usefulness_score, n.times_used, n.times_helpful, n.project_name,
           COALESCE(SUM(b.frequency), 0) as bm25_score
    FROM memory_nodes n
    INNER JOIN bm25_index b ON n.id = b.node_id
    WHERE b.term IN (${placeholders}) AND n.scope = ? ${projectFilter}
    GROUP BY n.id
    ORDER BY bm25_score DESC
    LIMIT ?
  `).all(...params) as SqliteNode[];
  return rows.map(r => rowToNode(r));
}