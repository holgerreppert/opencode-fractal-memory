import { Database } from "bun:sqlite";
import type { MemoryScope, MemoryNode, MemoryNodeLevel } from "./types";
import type { SqliteNode } from "./queries/base";
import { rowToNode } from "./queries/base";
import { withRetry } from "./utils";

export async function getExpiredNodes(
  getDb: (scope: MemoryScope) => Promise<Database>,
  scope: MemoryScope | "all" = "all",
  projectName?: string
): Promise<MemoryNode[]> {
  const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];
  const expired: MemoryNode[] = [];
  const now = Date.now();

  for (const s of scopes) {
    const db = await getDb(s);
    const projectFilter = projectName !== undefined && s === "project";
    const sql = `SELECT * FROM memory_nodes WHERE expires_at IS NOT NULL AND expires_at <= ? AND (type IS NULL OR type != 'skill')${projectFilter ? " AND project_name = ?" : ""}`;
    const params: (string | number)[] = [now];
    if (projectFilter) params.push(projectName);
    const rows = db.query(sql).all(...params) as SqliteNode[];
    expired.push(...rows.map(rowToNode));
  }

  return expired;
}

export async function deleteExpiredNodes(
  getDb: (scope: MemoryScope) => Promise<Database>,
  scope: MemoryScope | "all" = "all",
  projectName?: string
): Promise<number> {
  const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];
  let deleted = 0;

  for (const s of scopes) {
    const db = await getDb(s);
    const projectFilter = projectName !== undefined && s === "project";
    const sql = `DELETE FROM memory_nodes WHERE expires_at IS NOT NULL AND expires_at <= ? AND (type IS NULL OR type != 'skill')${projectFilter ? " AND project_name = ?" : ""}`;
    const params: (string | number)[] = [Date.now()];
    if (projectFilter) params.push(projectName);
    const result = db.run(sql, params);
    deleted += Number(result.changes);
  }

  return deleted;
}

export async function pruneNodes(
  deps: {
    getDb: (scope: MemoryScope) => Promise<Database>;
    listNodes: (scope: MemoryScope | "all", level?: MemoryNodeLevel, limit?: number, offset?: number, includeExpired?: boolean, projectName?: string) => Promise<MemoryNode[]>;
  },
  scope: MemoryScope | "all",
  options: {
    minAccessCount?: number;
    maxAgeDays?: number;
    minImportance?: number;
    excludeSticky?: boolean;
    excludeCore?: boolean;
    dryRun?: boolean;
  } = {},
  projectName?: string
): Promise<{ prunable: MemoryNode[]; pruned: number }> {
  const {
    minAccessCount = 0,
    maxAgeDays = 90,
    minImportance = 0,
    excludeSticky = true,
    excludeCore = true,
    dryRun = true,
  } = options;

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - maxAgeMs;
  const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];

  const prunable: MemoryNode[] = [];
  const coreLabels = new Set(["persona", "human", "current-state", "project"]);

  for (const s of scopes) {
    const nodes = await deps.listNodes(s, undefined, undefined, undefined, undefined, projectName);

    for (const node of nodes) {
      if (excludeSticky && node.sticky) continue;

      if (excludeCore && node.label && coreLabels.has(node.label)) continue;

      if (node.importance >= 0.9) continue;

      const isLowAccess = node.accessCount <= minAccessCount;
      const isStale = node.updatedAt.getTime() < cutoffTime;
      const isLowImportance = node.importance < minImportance;

      if ((isLowAccess || isStale) && isLowImportance) {
        prunable.push(node);
      }
    }
  }

  let pruned = 0;
  if (!dryRun && prunable.length > 0) {
    const byScope = new Map<MemoryScope, string[]>();
    for (const node of prunable) {
      const list = byScope.get(node.scope);
      if (list) list.push(node.id);
      else byScope.set(node.scope, [node.id]);
    }
    for (const [s, ids] of byScope) {
      const db = await deps.getDb(s);
      const placeholders = ids.map(() => "?").join(",");
      await withRetry(() => db.run(`DELETE FROM memory_nodes WHERE id IN (${placeholders})`, ids));
      pruned += ids.length;
    }
  }

  return { prunable, pruned };
}
