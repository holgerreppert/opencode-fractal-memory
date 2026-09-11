import { Database } from "bun:sqlite";
import type { SqliteNode } from "./base";
import { rowToNode } from "./base";
import type { MemoryScope, MemoryNode, MemoryNodeType, MemoryCategory, MemoryDomain, MemoryNodeLevel } from "../types";
import type { SearchFilter } from "../../domain/ports/SearchStore";

export type { SearchFilter };

export interface ScoredNode {
  node: MemoryNode;
  score: number;
}

function applyFilters(baseWhere: string, params: (string | number)[], filter?: SearchFilter): { where: string; params: (string | number)[] } {
  let w = baseWhere;
  const p = [...params];
  if (filter?.typeFilter != null) { w += " AND n.type = ?"; p.push(filter.typeFilter); }
  if (filter?.categoryFilter != null) { w += " AND n.category = ?"; p.push(filter.categoryFilter); }
  if (filter?.domainFilter != null) { w += " AND n.domain = ?"; p.push(filter.domainFilter); }
  if (filter?.minLevel != null) { w += " AND n.level >= ?"; p.push(filter.minLevel); }
  if (filter?.maxLevel != null) { w += " AND n.level <= ?"; p.push(filter.maxLevel); }
  if (filter?.tagsFilter && filter.tagsFilter.length > 0) {
    for (const tag of filter.tagsFilter) {
      w += " AND n.tags LIKE ?";
      p.push(`%${tag}%`);
    }
  }
  return { where: w, params: p };
}

export function querySearchText(db: Database, scope: MemoryScope, query: string, limit: number, projectName?: string, filter?: SearchFilter): ScoredNode[] {
  const lowerQuery = `%${query.toLowerCase()}%`;
  const hasProjectFilter = !!(projectName && scope === "project");
  const baseParams: (string | number)[] = [scope, lowerQuery, lowerQuery];
  if (hasProjectFilter) baseParams.push(projectName!);

  let baseWhere = "WHERE n.scope = ? AND (LOWER(n.label) LIKE ? OR LOWER(n.content) LIKE ?)";
  if (hasProjectFilter) baseWhere += " AND n.project_name = ?";
  const { where, params } = applyFilters(baseWhere, baseParams, filter);
  params.push(limit);

  const rows = db.query(`
    SELECT n.id, n.scope, n.label, n.content, n.summary, n.level, n.parent_ids, n.embedding_blob, n.embedding_segments,
           n.created_at, n.updated_at, n.importance, n.access_count, n.last_accessed,
           n.type, n.category, n.supertype, n.domain, n.tags, n.source, n.metadata, n.sticky, n.ttl_days, n.expires_at,
           n.confidence, n.last_verified, n.verification_count, n.usefulness_score, n.times_used, n.times_helpful, n.project_name,
           n.derived_from, n.derivation, n.status, n.valid_from, n.valid_until, n.supersedes_id, n.content_hash, n.subtask
    FROM memory_nodes n
    ${where}
    ORDER BY n.importance DESC
    LIMIT ?
  `).all(...params) as SqliteNode[];
  return rows.map(r => ({ node: rowToNode(r), score: r.importance ?? 0.5 }));
}

export function querySearchBM25(db: Database, scope: MemoryScope, terms: string[], limit: number, projectName?: string, filter?: SearchFilter): ScoredNode[] {
  const placeholders = terms.map(() => "?").join(",");
  const hasProjectFilter = !!(projectName && scope === "project");
  const baseParams: (string | number)[] = [...terms, scope];
  if (hasProjectFilter) baseParams.push(projectName);

  let baseWhere = `WHERE b.term IN (${placeholders}) AND n.scope = ?`;
  if (hasProjectFilter) baseWhere += " AND n.project_name = ?";
  const { where, params } = applyFilters(baseWhere, baseParams, filter);
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
    ${where}
    GROUP BY n.id
    ORDER BY bm25_score DESC
    LIMIT ?
  `).all(...params) as SqliteNode[];
  return rows.map(r => ({ node: rowToNode(r), score: (r as any).bm25_score ?? 0 }));
}
