import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runScoreDecay, calculateNodeConfidence } from "./scoring";
import { runMigrations } from "./migrations";
import type { MemoryNode } from "./types";

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

describe("calculateNodeConfidence", () => {
  test("returns confidence as-is for skill type nodes", () => {
    const node = makeNode({ type: "skill", confidence: 0.9 });
    expect(calculateNodeConfidence(node)).toBe(0.9);
  });

  test("returns 1 for max confidence on fresh node", () => {
    const node = makeNode({ confidence: 1, updatedAt: new Date() });
    expect(calculateNodeConfidence(node)).toBeGreaterThanOrEqual(0.99);
  });

  test("decays confidence for old nodes", () => {
    const oldDate = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    const node = makeNode({ confidence: 1, updatedAt: oldDate });
    const result = calculateNodeConfidence(node);
    expect(result).toBeLessThan(1);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  test("never returns negative confidence", () => {
    const veryOld = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000);
    const node = makeNode({ confidence: 0, updatedAt: veryOld });
    expect(calculateNodeConfidence(node)).toBeGreaterThanOrEqual(0);
  });

  test("verified bonus increases confidence for recently verified nodes", () => {
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const veryRecentVerify = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const verified = makeNode({ confidence: 0.5, updatedAt: old, lastVerified: veryRecentVerify });
    const unverified = makeNode({ confidence: 0.5, updatedAt: old, lastVerified: null });
    expect(calculateNodeConfidence(verified)).toBeGreaterThan(calculateNodeConfidence(unverified));
  });

  test("clamps confidence to [0, 1]", () => {
    const high = makeNode({ confidence: 2, updatedAt: new Date() });
    expect(calculateNodeConfidence(high)).toBeLessThanOrEqual(1);
  });
});

describe("runScoreDecay", () => {
  function setup() {
    const db = new Database(":memory:");
    runMigrations(db);
    const getDb = async () => db;
    return { db, getDb };
  }

  function insertNode(db: Database, overrides: {
    id?: string;
    usefulnessScore?: number;
    lastAccessed?: number | null;
    updatedAt?: number;
    type?: string | null;
  }) {
    const now = Date.now();
    db.run(
      `INSERT INTO memory_nodes (id, scope, label, content, level, created_at, updated_at, importance, usefulness_score, last_accessed, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        overrides.id ?? `node-${Math.random()}`,
        "project",
        "test",
        "content",
        0,
        now,
        overrides.updatedAt ?? now,
        0.5,
        overrides.usefulnessScore ?? 1.0,
        overrides.lastAccessed ?? null,
        overrides.type ?? null,
      ],
    );
  }

  test("decays score for nodes not accessed recently", async () => {
    const { db, getDb } = setup();
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    insertNode(db, { id: "old-node", usefulnessScore: 1.0, updatedAt: old, lastAccessed: old });
    insertNode(db, { id: "fresh-node", usefulnessScore: 1.0, updatedAt: Date.now() });

    const count = await runScoreDecay(getDb, 30);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("skips nodes with usefulnessScore of 0", async () => {
    const { db, getDb } = setup();
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    insertNode(db, { id: "zero-node", usefulnessScore: 0, updatedAt: old, lastAccessed: old });

    const count = await runScoreDecay(getDb, 30);
    expect(count).toBe(0);
  });

  test("skips skill type nodes", async () => {
    const { db, getDb } = setup();
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    insertNode(db, { id: "skill-node", usefulnessScore: 1.0, updatedAt: old, lastAccessed: old, type: "skill" });

    const count = await runScoreDecay(getDb, 30);
    expect(count).toBe(0);
  });

  test("returns 0 when all nodes are recent", async () => {
    const { db, getDb } = setup();
    insertNode(db, { id: "fresh", usefulnessScore: 1.0, updatedAt: Date.now() });

    const count = await runScoreDecay(getDb, 30);
    expect(count).toBe(0);
  });
});
