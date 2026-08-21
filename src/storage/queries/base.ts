
export interface SqliteNode {
  id: string;
  scope: string;
  label: string;
  content: string;
  summary: string | null;
  level: number;
  parent_ids: string | null;
  embedding: string | null;
  embedding_blob: Buffer | null;
  embedding_segments: string | null;
  created_at: number;
  updated_at: number;
  importance: number;
  access_count: number;
  last_accessed: number | null;
  type: string | null;
  category: string | null;
  supertype: string | null;
  domain: string | null;
  tags: string | null;
  source: string | null;
  metadata: string | null;
  sticky: number;
  ttl_days: number | null;
  expires_at: number | null;
  confidence: number;
  last_verified: number | null;
  verification_count: number;
  usefulness_score: number;
  times_used: number;
  times_helpful: number;
  project_name: string | null;
  derived_from: string | null;
  derivation: string | null;
  status: string | null;
  valid_from: number | null;
  valid_until: number | null;
  supersedes_id: string | null;
  content_hash: string | null;
}

import type { MemoryScope, MemoryNodeLevel, MemoryNodeType, MemoryNode, MemoryCategory, MemorySupertype, MemoryDomain } from "../../storage/types";
export type { MemoryScope, MemoryNodeLevel, MemoryNodeType, MemoryNode, MemoryCategory, MemorySupertype, MemoryDomain } from "../../storage/types";

export function blobToEmbedding(blob: Buffer | null): number[] | null {
  if (!blob) return null;
  const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.length / 4);
  return Array.from(floats);
}

export function embeddingToBlob(embedding: number[]): Buffer {
  const floatArray = new Float32Array(embedding);
  return Buffer.from(floatArray.buffer);
}

export function rowToNode(row: SqliteNode): MemoryNode {
  let embedding: number[] | null = null;
  if (row.embedding_blob) {
    embedding = blobToEmbedding(row.embedding_blob);
  } else if (row.embedding) {
    embedding = JSON.parse(row.embedding);
  }

  let embeddingSegments: number[][] | null = null;
  if (row.embedding_segments) {
    try {
      embeddingSegments = JSON.parse(row.embedding_segments);
    } catch {
      embeddingSegments = null;
    }
  }

  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    label: row.label ?? null,
    content: row.content,
    summary: row.summary,
    level: row.level as MemoryNodeLevel,
    parentIds: row.parent_ids ? JSON.parse(row.parent_ids) : null,
    embedding,
    embeddingSegments,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessed: row.last_accessed ? new Date(row.last_accessed) : null,
    type: row.type as MemoryNodeType | null,
    category: row.category as MemoryCategory | null,
    supertype: row.supertype as MemorySupertype | null,
    domain: row.domain as MemoryDomain,
    tags: row.tags ? JSON.parse(row.tags) : null,
    source: row.source ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    sticky: Boolean(row.sticky),
    ttlDays: row.ttl_days ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    confidence: row.confidence ?? 0.5,
    lastVerified: row.last_verified ? new Date(row.last_verified) : null,
    verificationCount: row.verification_count ?? 0,
    usefulnessScore: row.usefulness_score ?? 0,
    timesUsed: row.times_used ?? 0,
    timesHelpful: row.times_helpful ?? 0,
    projectName: row.project_name ?? null,
    derivedFrom: row.derived_from ? JSON.parse(row.derived_from) : null,
    derivation: row.derivation ?? null,
    status: (row.status as "active" | "proposed" | "superseded" | null) ?? "active",
    validFrom: row.valid_from ? new Date(row.valid_from) : null,
    validUntil: row.valid_until ? new Date(row.valid_until) : null,
    supersedesId: row.supersedes_id ?? null,
    contentHash: row.content_hash ?? null,
  };
}