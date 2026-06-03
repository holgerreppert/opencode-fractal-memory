import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureSeed, getNode, verifyNode, resolveNode } from "./lifecycle";
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
  const globalDb = new Database(":memory:");
  const projectDb = new Database(":memory:");
  runMigrations(globalDb);
  runMigrations(projectDb);

  const dbs = new Map<MemoryScope, Database>([
    ["global", globalDb],
    ["project", projectDb],
  ]);

  const getDb = async (scope: MemoryScope): Promise<Database> => {
    const db = dbs.get(scope);
    if (!db) throw new Error(`No DB for scope: ${scope}`);
    return db;
  };

  function insertNode(db: Database, overrides: Partial<{
    id: string;
    scope: string;
    label: string;
    content: string;
    level: number;
    confidence: number;
    accessCount: number;
    lastAccessed: number | null;
    type: string | null;
  }> = {}) {
    const now = Date.now();
    const id = overrides.id ?? `n-${Math.random().toString(36).slice(2, 8)}`;
    db.run(
      `INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, overrides.scope ?? "project", overrides.label ?? "test",
        overrides.content ?? "content", null, overrides.level ?? 0,
        null, null, now, now, 0.5, overrides.accessCount ?? 0,
        overrides.lastAccessed ?? null, overrides.type ?? null, null,
        0, overrides.confidence ?? 0.5, null,
      ],
    );
    return id;
  }

  return { getDb, globalDb, projectDb, dbs, insertNode };
}

describe("ensureSeed", () => {
  test("creates seed node when no existing node with label", async () => {
    const { getDb, projectDb } = setup();
    await ensureSeed(getDb, [{ scope: "project", label: "test-seed" }]);

    const row = projectDb.query("SELECT label FROM memory_nodes WHERE label = ?").get("test-seed") as { label: string } | null;
    expect(row).not.toBeNull();
    expect(row!.label).toBe("test-seed");
  });

  test("skips seed if node with label already exists", async () => {
    const { getDb, projectDb } = setup();
    const now = Date.now();
    projectDb.run(
      "INSERT INTO memory_nodes (id, scope, label, content, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["existing-id", "project", "existing-seed", "existing content", 0, now, now],
    );

    await ensureSeed(getDb, [{ scope: "project", label: "existing-seed" }]);

    const rows = projectDb.query("SELECT COUNT(*) as cnt FROM memory_nodes WHERE label = ?").get("existing-seed") as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  test("creates seed in global scope", async () => {
    const { getDb, globalDb } = setup();
    await ensureSeed(getDb, [{ scope: "global", label: "global-seed" }]);

    const row = globalDb.query("SELECT label FROM memory_nodes WHERE label = ?").get("global-seed") as { label: string } | null;
    expect(row).not.toBeNull();
  });

  test("handles multiple seeds with different scopes", async () => {
    const { getDb, globalDb, projectDb } = setup();
    await ensureSeed(getDb, [
      { scope: "global", label: "g-seed" },
      { scope: "project", label: "p-seed" },
    ]);

    expect(globalDb.query("SELECT id FROM memory_nodes WHERE label = ?").get("g-seed")).not.toBeNull();
    expect(projectDb.query("SELECT id FROM memory_nodes WHERE label = ?").get("p-seed")).not.toBeNull();
  });
});

describe("getNode", () => {
  test("returns node and increments access count", async () => {
    const { getDb, projectDb } = setup();
    const id = setup().insertNode(projectDb, { id: "get-test", confidence: 0.5, accessCount: 0 });

    const node = await getNode(getDb, id);

    expect(node.id).toBe(id);
    expect(node.accessCount).toBe(1);
    expect(node.confidence).toBeGreaterThan(0.5);

    const row = projectDb.query("SELECT access_count, confidence FROM memory_nodes WHERE id = ?").get(id) as { access_count: number; confidence: number };
    expect(row.access_count).toBe(1);
    expect(row.confidence).toBeGreaterThan(0.5);
  });

  test("searches both scopes for the node", async () => {
    const { getDb, projectDb } = setup();
    const id = setup().insertNode(projectDb, { id: "cross-scope", scope: "global" });

    const node = await getNode(getDb, id);
    expect(node).toBeDefined();
  });

  test("throws when node does not exist", async () => {
    const { getDb } = setup();
    expect(getNode(getDb, "nonexistent-id")).rejects.toThrow("Memory node not found");
  });

  test("returns correct node data", async () => {
    const { getDb, projectDb } = setup();
    const id = setup().insertNode(projectDb, {
      id: "data-check",
      label: "data-test",
      content: "specific data content",
      type: "note",
      confidence: 0.7,
    });

    const node = await getNode(getDb, id);
    expect(node.label).toBe("data-test");
    expect(node.content).toBe("specific data content");
    expect(node.type).toBe("note");
  });
});

describe("verifyNode", () => {
  test("increments confidence on verification", async () => {
    const { getDb, projectDb } = setup();
    const id = setup().insertNode(projectDb, { id: "verify-conf", confidence: 0.5 });

    const node = await verifyNode(getDb, id);
    expect(node.confidence).toBeGreaterThan(0.5);

    const row = projectDb.query("SELECT confidence FROM memory_nodes WHERE id = ?").get(id) as { confidence: number };
    expect(row.confidence).toBeGreaterThan(0.5);
  });

  test("caps confidence at 1.0", async () => {
    const { getDb, projectDb } = setup();
    const id = setup().insertNode(projectDb, { id: "cap-conf", confidence: 0.95 });

    const node = await verifyNode(getDb, id);
    expect(node.confidence).toBeLessThanOrEqual(1);
  });

  test("sets last_verified timestamp", async () => {
    const { getDb, projectDb } = setup();
    const id = setup().insertNode(projectDb, { id: "verify-ts", confidence: 0.5 });

    await verifyNode(getDb, id);

    const row = projectDb.query("SELECT last_verified FROM memory_nodes WHERE id = ?").get(id) as { last_verified: number | null };
    expect(row.last_verified).not.toBeNull();
    expect(row.last_verified).toBeGreaterThan(0);
  });

  test("throws when node does not exist", async () => {
    const { getDb } = setup();
    expect(verifyNode(getDb, "missing-id")).rejects.toThrow("Memory node not found");
  });
});

describe("resolveNode", () => {
  test("resolves node in project scope", async () => {
    const { getDb, projectDb, dbs } = setup();
    const id = setup().insertNode(projectDb, { id: "resolve-project" });
    const cache = new Map<string, MemoryScope>();

    const result = await resolveNode(getDb, cache, id);

    expect(result.scope).toBe("project");
    expect(result.db).toBe(dbs.get("project"));
  });

  test("resolves node in global scope", async () => {
    const { getDb, globalDb, dbs } = setup();
    const id = setup().insertNode(globalDb, { id: "resolve-global", scope: "global" });
    const cache = new Map<string, MemoryScope>();

    const result = await resolveNode(getDb, cache, id);

    expect(result.scope).toBe("global");
    expect(result.db).toBe(dbs.get("global"));
  });

  test("caches resolved scope", async () => {
    const { getDb, globalDb } = setup();
    const id = setup().insertNode(globalDb, { id: "cache-me", scope: "global" });
    const cache = new Map<string, MemoryScope>();

    await resolveNode(getDb, cache, id);
    expect(cache.get(id)).toBe("global");
  });

  test("uses cache to skip re-resolution", async () => {
    const { getDb, dbs } = setup();
    const cache = new Map<string, MemoryScope>([["cached-id", "project"]]);

    const result = await resolveNode(getDb, cache, "cached-id");

    expect(result.scope).toBe("project");
    expect(result.db).toBe(dbs.get("project"));
  });

  test("throws when node does not exist", async () => {
    const { getDb } = setup();
    expect(resolveNode(getDb, new Map(), "ghost")).rejects.toThrow("Memory node not found");
  });
});
