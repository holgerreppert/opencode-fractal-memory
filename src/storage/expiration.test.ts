import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getExpiredNodes, deleteExpiredNodes, pruneNodes } from "./expiration";
import { runMigrations } from "./migrations";
import type { MemoryNode } from "./types";

type MemoryScope = "global" | "project";

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: overrides.id ?? "node-1",
    scope: overrides.scope ?? "project",
    label: overrides.label ?? "test-node",
    content: overrides.content ?? "Some content",
    summary: overrides.summary ?? null,
    level: overrides.level ?? 0,
    parentIds: overrides.parentIds ?? null,
    embedding: overrides.embedding ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    importance: overrides.importance ?? 0.5,
    accessCount: overrides.accessCount ?? 0,
    lastAccessed: overrides.lastAccessed ?? null,
    type: overrides.type ?? null,
    metadata: overrides.metadata ?? null,
    sticky: overrides.sticky ?? false,
    confidence: overrides.confidence ?? 0,
    lastVerified: overrides.lastVerified ?? null,
    usefulnessScore: overrides.usefulnessScore ?? 0,
    timesUsed: overrides.timesUsed ?? 0,
    timesHelpful: overrides.timesHelpful ?? 0,
  };
}

function setup() {
  const db = new Database(":memory:");
  runMigrations(db);
  const getDb = async () => db;

  function insertNode(overrides: {
    id?: string;
    scope?: string;
    expiresAt?: number | null;
    type?: string | null;
    sticky?: number;
    importance?: number;
    accessCount?: number;
    updatedAt?: number;
    label?: string;
  } = {}) {
    const now = Date.now();
    const id = overrides.id ?? `n-${Math.random().toString(36).slice(2, 8)}`;
    db.run(
      `INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, overrides.scope ?? "project", overrides.label ?? "test",
        "content", null, 0, null, null, now, overrides.updatedAt ?? now,
        overrides.importance ?? 0.5, overrides.accessCount ?? 0, null,
        overrides.type ?? null, null, overrides.sticky ?? 0, 0.5, null,
        overrides.expiresAt ?? null,
      ],
    );
    return id;
  }

  return { db, getDb, insertNode };
}

describe("getExpiredNodes", () => {
  test("returns expired nodes", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "expired", expiresAt: Date.now() - 1000 });
    insertNode({ id: "not-expired", expiresAt: Date.now() + 86400000 });

    const expired = await getExpiredNodes(getDb, "project");
    const ids = expired.map(n => n.id);
    expect(ids).toContain("expired");
    expect(ids).not.toContain("not-expired");
  });

  test("skips nodes without expires_at", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "no-expiry" });

    const expired = await getExpiredNodes(getDb, "project");
    expect(expired.find(n => n.id === "no-expiry")).toBeUndefined();
  });

  test("skips skill type nodes", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "skill-expired", expiresAt: Date.now() - 1000, type: "skill" });

    const expired = await getExpiredNodes(getDb, "project");
    expect(expired.find(n => n.id === "skill-expired")).toBeUndefined();
  });

  test("returns empty when no expired nodes", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "future", expiresAt: Date.now() + 86400000 });

    const expired = await getExpiredNodes(getDb, "project");
    expect(expired).toHaveLength(0);
  });

  test("scopes to \"all\" searches both scopes", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "global-expired", scope: "global", expiresAt: Date.now() - 1000 });
    insertNode({ id: "project-expired", scope: "project", expiresAt: Date.now() - 1000 });

    const expired = await getExpiredNodes(getDb, "all");
    const ids = expired.map(n => n.id);
    expect(ids).toContain("global-expired");
    expect(ids).toContain("project-expired");
  });
});

describe("deleteExpiredNodes", () => {
  test("deletes expired nodes", async () => {
    const { getDb, db, insertNode } = setup();
    insertNode({ id: "to-delete", expiresAt: Date.now() - 1000 });

    const deleted = await deleteExpiredNodes(getDb, "project");
    expect(deleted).toBe(1);

    const row = db.query("SELECT id FROM memory_nodes WHERE id = ?").get("to-delete");
    expect(row).toBeNull();
  });

  test("does not delete non-expired nodes", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "keep", expiresAt: Date.now() + 86400000 });

    const deleted = await deleteExpiredNodes(getDb, "project");
    expect(deleted).toBe(0);
  });

  test("skips skill type expired nodes", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "skill-exp", expiresAt: Date.now() - 1000, type: "skill" });

    const deleted = await deleteExpiredNodes(getDb, "project");
    expect(deleted).toBe(0);
  });

  test("deletes across all scopes", async () => {
    const { getDb, insertNode } = setup();
    insertNode({ id: "g-del", scope: "global", expiresAt: Date.now() - 1000 });
    insertNode({ id: "p-del", scope: "project", expiresAt: Date.now() - 1000 });

    const deleted = await deleteExpiredNodes(getDb, "all");
    expect(deleted).toBe(2);
  });
});

describe("pruneNodes", () => {
  test("returns prunable low-importance stale nodes", async () => {
    const { getDb, insertNode } = setup();
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    insertNode({ id: "prunable", importance: 0.1, accessCount: 0, updatedAt: old });

    const listNodes = async () => [makeNode({ id: "prunable", importance: 0.1, accessCount: 0, scope: "project", updatedAt: new Date(old), sticky: false })];

    const result = await pruneNodes({ getDb, listNodes }, "project", { dryRun: true, minImportance: 0.5 });
    expect(result.prunable.length).toBeGreaterThanOrEqual(1);
  });

  test("does not prune high importance nodes", async () => {
    const listNodes = async () => [makeNode({ id: "important", importance: 0.95, accessCount: 0, scope: "project", sticky: false })];

    const result = await pruneNodes({ getDb: async () => new Database(":memory:") as any, listNodes }, "project", { dryRun: true, maxAgeDays: 1 });
    expect(result.prunable).toHaveLength(0);
  });

  test("skips sticky nodes when excludeSticky is true", async () => {
    const listNodes = async () => [makeNode({ id: "sticky", importance: 0.1, accessCount: 0, scope: "project", sticky: true })];

    const result = await pruneNodes({ getDb: async () => new Database(":memory:") as any, listNodes }, "project", { dryRun: true });
    expect(result.prunable).toHaveLength(0);
  });

  test("skips core label nodes", async () => {
    const listNodes = async () => [makeNode({ id: "core", label: "persona", importance: 0.1, accessCount: 0, scope: "project", sticky: false })];

    const result = await pruneNodes({ getDb: async () => new Database(":memory:") as any, listNodes }, "project", { dryRun: true });
    expect(result.prunable).toHaveLength(0);
  });

  test("includes sticky nodes when excludeSticky is false", async () => {
    const listNodes = async () => [makeNode({ id: "sticky-included", importance: 0.1, accessCount: 0, scope: "project", sticky: true })];

    const result = await pruneNodes({ getDb: async () => new Database(":memory:") as any, listNodes }, "project", { dryRun: true, excludeSticky: false, minImportance: 0.5 });
    expect(result.prunable.length).toBeGreaterThanOrEqual(1);
  });
});
