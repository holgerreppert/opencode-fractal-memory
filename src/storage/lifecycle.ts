import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { MemoryScope, MemoryNode } from "./types";
import type { SqliteNode } from "./queries/base";
import { rowToNode } from "./queries/base";
import { queryGetNode } from "./queries/nodes";
import { withRetry } from "./utils";

export async function ensureSeed(
  getDb: (scope: MemoryScope) => Promise<Database>,
  seeds: Array<{ scope: MemoryScope; label: string }>,
  projectName?: string
): Promise<void> {
  for (const seed of seeds) {
    const db = await getDb(seed.scope);
    const existing = db.query("SELECT id FROM memory_nodes WHERE label = ? AND scope = ?").get(seed.label, seed.scope);
    if (existing) continue;

    const now = Date.now();

    try {
      await withRetry(() => {
        db.run(
          "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata, project_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [randomUUID(), seed.scope, seed.label, "", null, 0, null, null, now, now, 0.5, 0, null, "note", null, seed.scope === "project" ? projectName ?? null : null],
        );
      });
    } catch {
      // race condition: another process inserted this seed before us
    }
  }
}

export async function resolveNode(
  getDb: (scope: MemoryScope) => Promise<Database>,
  idScopeCache: Map<string, MemoryScope>,
  id: string
): Promise<{ scope: MemoryScope; db: Database }> {
  if (idScopeCache.has(id)) {
    const scope = idScopeCache.get(id)!;
    return { scope, db: await getDb(scope) };
  }

  for (const scope of ["global", "project"] as MemoryScope[]) {
    const db = await getDb(scope);
    const existing = db.query("SELECT id FROM memory_nodes WHERE id = ?").get(id) as { id: string } | null;
    if (existing) {
      idScopeCache.set(id, scope);
      return { scope, db };
    }
  }

  throw new Error(`Memory node not found: ${id}`);
}

export async function getNode(
  getDb: (scope: MemoryScope) => Promise<Database>,
  id: string
): Promise<MemoryNode> {
  let foundNode: MemoryNode | null = null;
  let foundScope: MemoryScope | null = null;

  for (const scope of ["global", "project"] as MemoryScope[]) {
    const node = await queryGetNode(await getDb(scope), id);
    if (node) {
      foundNode = node;
      foundScope = scope;
      break;
    }
  }

  if (!foundNode || !foundScope) {
    throw new Error(`Memory node not found: ${id}`);
  }

  const db = await getDb(foundScope);
  const newAccessCount = foundNode.accessCount + 1;
  const newConfidence = Math.min(1, foundNode.confidence + 0.01);
  db.run(
    "UPDATE memory_nodes SET access_count = ?, last_accessed = ?, confidence = ? WHERE id = ?",
    [newAccessCount, Date.now(), newConfidence, id]
  );

  return { ...foundNode, accessCount: newAccessCount, confidence: newConfidence };
}

export async function verifyNode(
  getDb: (scope: MemoryScope) => Promise<Database>,
  id: string
): Promise<MemoryNode> {
  for (const scope of ["global", "project"] as MemoryScope[]) {
    const db = await getDb(scope);
    const existing = db.query("SELECT * FROM memory_nodes WHERE id = ?").get(id) as SqliteNode | null;

    if (existing) {
      const newConfidence = Math.min(1, (existing.confidence ?? 0.5) + 0.2);
      await withRetry(() => {
        db.run(
          "UPDATE memory_nodes SET confidence = ?, last_verified = ? WHERE id = ?",
          [newConfidence, Date.now(), id]
        );
      });
      return rowToNode({ ...existing, confidence: newConfidence, last_verified: Date.now() });
    }
  }
  throw new Error(`Memory node not found: ${id}`);
}
