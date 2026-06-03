import { Database } from "bun:sqlite";
import type { MemoryScope } from "../types";

export async function queryStoreLinks(
  db: Database,
  sourceId: string,
  content: string,
  getNodeByLabel: (db: Database, scope: MemoryScope, label: string) => Promise<{ id: string } | null>
): Promise<void> {
  const { extractLinks } = await import("../utils");
  const links = extractLinks(content);
  
  db.run("DELETE FROM memory_links WHERE source_id = ?", [sourceId]);
  
  for (const label of links) {
    let targetId: string | null = null;
    try {
      const target = await getNodeByLabel(db, "global", label);
      if (!target) {
        const targetProject = await getNodeByLabel(db, "project", label);
        targetId = targetProject?.id ?? null;
      } else {
        targetId = target.id;
      }
    } catch { /* Target doesn't exist yet */ }
    
    db.run(
      "INSERT OR REPLACE INTO memory_links (source_id, target_label, target_id) VALUES (?, ?, ?)",
      [sourceId, label, targetId]
    );
  }
}

export function queryUpdateLinksForNewNode(
  db: Database,
  label: string,
  nodeId: string
): void {
  db.run("UPDATE memory_links SET target_id = ? WHERE target_label = ? AND target_id IS NULL", [nodeId, label]);
}

export function queryGetLinks(db: Database, sourceId: string): { target_label: string; target_id: string | null }[] {
  return db.query("SELECT target_label, target_id FROM memory_links WHERE source_id = ?").all(sourceId) as { target_label: string; target_id: string | null }[];
}

export function queryDeleteLinks(db: Database, sourceId: string): void {
  db.run("DELETE FROM memory_links WHERE source_id = ?", [sourceId]);
}

export function queryDeleteLinksForTarget(db: Database, targetId: string): void {
  db.run("DELETE FROM memory_links WHERE target_id = ?", [targetId]);
}