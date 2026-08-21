import { Database } from "bun:sqlite";
import { randomUUID, createHash } from "node:crypto";
import type { SqliteNode } from "./base";
import { embeddingToBlob, rowToNode } from "./base";
import type { MemoryScope, MemoryNodeLevel, MemoryNode, MemoryCategory, CreateNodeInput } from "../types";
import { getHNSWIndex } from "../../infrastructure/vector/hnsw-index";
import { z } from "zod";
import { memLog } from "../../logging";
import {
  resolveNodeCategory, resolveNodeSupertype, resolveNodeDomain,
  autoGenerateMetadata, validateLabel,
} from "./type-metadata";

const CreateNodeSchema = z.object({
  scope: z.enum(["global", "project"]),
  label: z.string().optional(),
  content: z.string(),
  summary: z.string().nullable().optional(),
  level: z.number().int().min(0).max(5).optional(),
  parentIds: z.array(z.string()).nullable().optional(),
  embedding: z.array(z.number()).nullable().optional(),
  embeddingSegments: z.array(z.array(z.number())).nullable().optional(),
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
  derivedFrom: z.array(z.string()).nullable().optional(),
  derivation: z.string().nullable().optional(),
  status: z.enum(["active", "proposed", "superseded"]).nullable().optional(),
  validFrom: z.number().nullable().optional(),
  validUntil: z.number().nullable().optional(),
  supersedesId: z.string().nullable().optional(),
  contentHash: z.string().nullable().optional(),
});

export function queryListProjectNames(db: Database, scope: MemoryScope): string[] {
  const rows = db.prepare(
    "SELECT DISTINCT project_name FROM memory_nodes WHERE scope = ? AND project_name IS NOT NULL AND project_name != '' ORDER BY project_name COLLATE NOCASE"
  ).all(scope) as Array<{ project_name: string }>;
  return rows.map((r) => r.project_name);
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
  // Exclude superseded nodes by default (provenance lifecycle)
  conditions.push("(status IS NULL OR status != 'superseded')");
  
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
  const sticky = node.type === "dot" ? 1 : (node.type === "skill" ? 1 : (node.sticky ? 1 : 0));
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
  const derivedFrom = node.derivedFrom ?? null;
  const derivation = node.derivation ?? null;
  const status = node.status ?? "active";
  const validFrom = node.validFrom ? (node.validFrom instanceof Date ? node.validFrom.getTime() : node.validFrom) : now;
  const validUntil = node.validUntil ? (node.validUntil instanceof Date ? node.validUntil.getTime() : node.validUntil) : null;
  const supersedesId = node.supersedesId ?? null;
  const contentHash = node.contentHash ?? createHash("sha256").update(node.content).digest("hex");

  db.run(
    "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, embedding_segments, created_at, updated_at, importance, access_count, last_accessed, type, category, supertype, domain, tags, source, metadata, sticky, ttl_days, expires_at, confidence, verification_count, usefulness_score, times_used, times_helpful, project_name, derived_from, derivation, status, valid_from, valid_until, supersedes_id, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      node.embeddingSegments ? JSON.stringify(node.embeddingSegments) : null,
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
      derivedFrom ? JSON.stringify(derivedFrom) : null,
      derivation,
      status,
      validFrom,
      validUntil,
      supersedesId,
      contentHash,
    ],
  );

  // Contradiction / supersession: for fact/decision/knowledge with same label, overlapping tags → mark older active as superseded
  if (node.label && ["fact", "decision", "knowledge", "convention", "lesson"].includes(node.type ?? "")) {
    try {
      const existing = db.query("SELECT id, tags FROM memory_nodes WHERE label = ? AND scope = ? AND status = 'active' AND id != ?").all(node.label, node.scope, id) as Array<{ id: string; tags: string | null }>;
      for (const row of existing) {
        const oldTags: string[] = row.tags ? JSON.parse(row.tags) : [];
        const newTags: string[] = resolvedTags ?? [];
        const overlap = newTags.length === 0 || oldTags.length === 0 ? false : newTags.some(t => oldTags.includes(t));
        // supersede if tags overlap or both have no tags but same label+type
        if (overlap || (resolvedTags === null && row.tags === null)) {
          db.run("UPDATE memory_nodes SET status = 'superseded', valid_until = ? WHERE id = ?", [now, row.id]);
          db.run("UPDATE memory_nodes SET supersedes_id = ? WHERE id = ?", [row.id, id]);
          memLog("info", "provenance", "superseded", { oldId: row.id, newId: id, label: node.label, type: node.type });
        }
      }
    } catch (e) {
      memLog("warn", "provenance", "supersession check failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Store links
  await storeLinks(node.scope, id, node.content);
  if (node.label) {
    await updateLinksForNewNode(node.scope, node.label, id);
  }
  updateBM25Index(db, id, node.content, node.label, node.scope);

  // HNSW add is outside transaction (in-memory) — one point per segment
  const hnsw = getHNSWIndex();
  if (node.embedding) {
    await hnsw.addNode(node.scope, id, node.embedding);
  }
  if (node.embeddingSegments && node.embeddingSegments.length > 0) {
    for (const seg of node.embeddingSegments) {
      await hnsw.addNode(node.scope, id, seg);
    }
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
    embeddingSegments: node.embeddingSegments ?? null,
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
    derivedFrom: derivedFrom,
    derivation: derivation,
    status: status as "active" | "proposed" | "superseded",
    validFrom: new Date(validFrom),
    validUntil: validUntil ? new Date(validUntil) : null,
    supersedesId: supersedesId,
    contentHash: contentHash,
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
  embeddingSegments: (v) => [
    ["embedding_segments = ?", v ? JSON.stringify(v) : null],
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
  derivedFrom: (v) => [["derived_from = ?", v ? JSON.stringify(v) : null]],
  derivation: (v) => [["derivation = ?", v as string | null]],
  status: (v) => [["status = ?", v as string | null]],
  validFrom: (v) => [["valid_from = ?", v ? (v instanceof Date ? v.getTime() : v as number) : null]],
  validUntil: (v) => [["valid_until = ?", v ? (v instanceof Date ? v.getTime() : v as number) : null]],
  supersedesId: (v) => [["supersedes_id = ?", v as string | null]],
  contentHash: (v) => [["content_hash = ?", v as string | null]],
};

export async function queryUpdateNode(
  db: Database,
  id: string,
  updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "category" | "supertype" | "domain" | "tags" | "source" | "metadata" | "embedding" | "embeddingSegments" | "sticky" | "ttlDays" | "confidence" | "verificationCount" | "usefulnessScore" | "timesHelpful" | "derivedFrom" | "derivation" | "status" | "validFrom" | "validUntil" | "supersedesId" | "contentHash">>
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
