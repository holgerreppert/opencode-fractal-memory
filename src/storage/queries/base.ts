
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
  created_at: number;
  updated_at: number;
  importance: number;
  access_count: number;
  last_accessed: number | null;
  type: string | null;
  category: string | null;
  metadata: string | null;
  sticky: number;
  ttl_days: number | null;
  expires_at: number | null;
  confidence: number;
  last_verified: number | null;
  usefulness_score: number;
  times_used: number;
  times_helpful: number;
  project_name: string | null;
}

import type { MemoryScope, MemoryNodeLevel, MemoryNodeType, MemoryNode, MemoryCategory } from "../../storage/types";
export type { MemoryScope, MemoryNodeLevel, MemoryNodeType, MemoryNode, MemoryCategory } from "../../storage/types";

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

  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    label: row.label ?? null,
    content: row.content,
    summary: row.summary,
    level: row.level as MemoryNodeLevel,
    parentIds: row.parent_ids ? JSON.parse(row.parent_ids) : null,
    embedding,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessed: row.last_accessed ? new Date(row.last_accessed) : null,
    type: row.type as MemoryNodeType | null,
    category: row.category as MemoryCategory | null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    sticky: Boolean(row.sticky),
    ttlDays: row.ttl_days ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    confidence: row.confidence ?? 0.5,
    lastVerified: row.last_verified ? new Date(row.last_verified) : null,
    usefulnessScore: row.usefulness_score ?? 0,
    timesUsed: row.times_used ?? 0,
    timesHelpful: row.times_helpful ?? 0,
    projectName: row.project_name ?? null,
  };
}