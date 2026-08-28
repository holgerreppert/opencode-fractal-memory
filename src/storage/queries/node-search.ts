import { Database } from "bun:sqlite";
import type { SqliteNode } from "./base";
import { rowToNode } from "./base";
import type { MemoryScope, MemoryNode } from "../types";

export function querySearchText(db: Database, scope: MemoryScope, query: string, limit: number, projectName?: string): MemoryNode[] {
  const lowerQuery = `%${query.toLowerCase()}%`;
  const hasProjectFilter = !!(projectName && scope === "project");
  const params: (string | number)[] = [scope, lowerQuery, lowerQuery];
  if (hasProjectFilter) params.push(projectName!);
  params.push(limit);
  const projectClause = hasProjectFilter ? "AND project_name = ?" : "";
  const rows = db.query(`
    SELECT id, scope, label, content, summary, level, parent_ids, embedding_blob, embedding_segments, created_at, updated_at,
           importance, access_count, last_accessed, type, category, supertype, domain, tags, source, metadata, sticky, ttl_days, expires_at,
           confidence, last_verified, verification_count, usefulness_score, times_used, times_helpful, project_name,
           derived_from, derivation, status, valid_from, valid_until, supersedes_id, content_hash, subtask
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
    SELECT n.id, n.scope, n.label, n.content, n.summary, n.level, n.parent_ids, n.embedding_blob, n.embedding_segments,
           n.created_at, n.updated_at, n.importance, n.access_count, n.last_accessed,
           n.type, n.category, n.supertype, n.domain, n.tags, n.source, n.metadata, n.sticky, n.ttl_days, n.expires_at,
           n.confidence, n.last_verified, n.verification_count, n.usefulness_score, n.times_used, n.times_helpful, n.project_name,
           n.derived_from, n.derivation, n.status, n.valid_from, n.valid_until, n.supersedes_id, n.content_hash, n.subtask,
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
