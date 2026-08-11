import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { memLog } from "../logging";
import type { SqliteNode } from "./queries/base";

export async function migrateFromProjectDb(
  dbProvider: { getDb(scope?: "global" | "project"): Promise<Database>; projectDirectory: string },
  projectName: string,
): Promise<number> {
  const unifiedDb = await dbProvider.getDb();
  const oldDbPath = path.join(dbProvider.projectDirectory, ".opencode", "memory.db");
  if (!existsSync(oldDbPath)) return 0;

  memLog("info", "storage", "Migrating project DB to unified storage", { path: oldDbPath, projectName });

  const oldDb = new Database(oldDbPath);
  let migrated = 0;

  try {
    const oldNodes = oldDb.query("SELECT * FROM memory_nodes").all() as SqliteNode[];
    for (const oldRow of oldNodes) {
      const existing = unifiedDb.query("SELECT id FROM memory_nodes WHERE id = ?").get(oldRow.id) as { id: string } | null;
      if (existing) continue;

      unifiedDb.run(
        `INSERT OR IGNORE INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, ttl_days, expires_at, confidence, last_verified, usefulness_score, times_used, times_helpful, project_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          oldRow.id, oldRow.scope, oldRow.label, oldRow.content,
          oldRow.summary, oldRow.level, oldRow.parent_ids,
          oldRow.embedding, oldRow.embedding_blob,
          oldRow.created_at, oldRow.updated_at, oldRow.importance,
          oldRow.access_count, oldRow.last_accessed, oldRow.type,
          oldRow.metadata, oldRow.sticky ?? 0,
          oldRow.ttl_days, oldRow.expires_at,
          oldRow.confidence ?? 0.5, oldRow.last_verified,
          oldRow.usefulness_score ?? 0, oldRow.times_used ?? 0,
          oldRow.times_helpful ?? 0, projectName,
        ],
      );

      const bm25Rows = oldDb.query("SELECT * FROM bm25_index WHERE node_id = ?").all(oldRow.id) as Array<{ term: string; node_id: string; frequency: number; scope: string }>;
      for (const bm25 of bm25Rows) {
        unifiedDb.run(
          "INSERT OR IGNORE INTO bm25_index (term, node_id, frequency, scope, project_name) VALUES (?, ?, ?, ?, ?)",
          [bm25.term, bm25.node_id, bm25.frequency, bm25.scope, projectName],
        );
      }

      const docStats = oldDb.query("SELECT * FROM bm25_doc_stats WHERE node_id = ?").get(oldRow.id) as { node_id: string; token_count: number; scope: string } | null;
      if (docStats) {
        unifiedDb.run(
          "INSERT OR IGNORE INTO bm25_doc_stats (node_id, token_count, scope, project_name) VALUES (?, ?, ?, ?)",
          [docStats.node_id, docStats.token_count, docStats.scope, projectName],
        );
      }

      migrated++;
    }

    const oldLinks = oldDb.query("SELECT * FROM memory_links").all() as Array<{ source_id: string; target_label: string; target_id: string | null }>;
    for (const link of oldLinks) {
      unifiedDb.run(
        "INSERT OR IGNORE INTO memory_links (source_id, target_label, target_id) VALUES (?, ?, ?)",
        [link.source_id, link.target_label, link.target_id],
      );
    }

    memLog("info", "storage", "Project DB migration complete", { migrated });
  } finally {
    oldDb.close();
  }

  return migrated;
}
