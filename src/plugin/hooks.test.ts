import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../storage/migrations";
import { cleanupMiddleTermCaptures } from "./state";

function makeStore() {
  const db = new Database(":memory:");
  runMigrations(db);

  const store = {
    async listNodes(_scope: "all" | "global" | "project") {
      return db.query("SELECT id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified, usefulness_score, times_used, times_helpful, category, expires_at, project_name FROM memory_nodes").all().map((row: any) => ({
        id: row.id,
        scope: row.scope,
        label: row.label,
        content: row.content,
        summary: row.summary ?? null,
        level: row.level ?? 0,
        parentIds: row.parent_ids ? (typeof row.parent_ids === "string" ? JSON.parse(row.parent_ids) : row.parent_ids) : null,
        embedding: null,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        importance: row.importance ?? 0.5,
        accessCount: row.access_count ?? 0,
        lastAccessed: row.last_accessed ?? null,
        type: row.type ?? null,
        metadata: row.metadata ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) : null,
        sticky: !!row.sticky,
        confidence: row.confidence ?? 0,
        lastVerified: row.last_verified ?? null,
        usefulnessScore: row.usefulness_score ?? 0,
        timesUsed: row.times_used ?? 0,
        timesHelpful: row.times_helpful ?? 0,
      }));
    },
    async deleteNode(id: string) {
      db.run("DELETE FROM memory_nodes WHERE id = ?", [id]);
    },
    async createNode(node: any) {
      const now = Date.now();
      const metadata = node.metadata ? JSON.stringify(node.metadata) : null;
      const createdAt = (node.metadata?.timestamp as number | undefined) ?? now;
      db.run(
        `INSERT INTO memory_nodes (id, scope, label, content, level, type, created_at, updated_at, importance, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [node.id ?? `test-${Math.random().toString(36).slice(2, 8)}`, node.scope ?? "project", node.label ?? "test",
         node.content ?? "", node.level ?? 0, node.type ?? "note", createdAt, now, node.importance ?? 0.5, metadata],
      );
    },
  };

  return store;
}

describe("cleanupMiddleTermCaptures", () => {
  test("returns 0 when no middle-term captures exist", async () => {
    const store = makeStore();
    const result = await cleanupMiddleTermCaptures(store, 30);
    expect(result).toBe(0);
  });

  test("returns 0 when captures are within maxAge", async () => {
    const store = makeStore();
    await store.createNode({
      label: "middle-term:test:1",
      content: JSON.stringify({ workingCache: [] }),
      type: "note",
      importance: 0.8,
      metadata: { customType: "middle-term", sessionId: "test", timestamp: Date.now() },
    });
    const result = await cleanupMiddleTermCaptures(store, 30);
    expect(result).toBe(0);
  });

  test("deletes captures older than maxAge", async () => {
    const store = makeStore();
    const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await store.createNode({
      label: "middle-term:test:old",
      content: JSON.stringify({ workingCache: [] }),
      type: "note",
      importance: 0.8,
      metadata: { customType: "middle-term", sessionId: "test", timestamp: oldTimestamp },
    });
    const result = await cleanupMiddleTermCaptures(store, 30);
    expect(result).toBe(1);
  });

  test("skips nodes without customType metadata", async () => {
    const store = makeStore();
    await store.createNode({
      label: "regular-node",
      content: "some content",
      type: "note",
      importance: 0.5,
    });
    const result = await cleanupMiddleTermCaptures(store, 30);
    expect(result).toBe(0);
  });

  test("skips nodes with non-matching customType", async () => {
    const store = makeStore();
    const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await store.createNode({
      label: "other-type",
      content: "some content",
      type: "note",
      importance: 0.5,
      metadata: { customType: "other", sessionId: "test", timestamp: oldTimestamp },
    });
    const result = await cleanupMiddleTermCaptures(store, 30);
    expect(result).toBe(0);
  });

  test("only deletes old captures, keeps recent ones mixed", async () => {
    const store = makeStore();
    const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await store.createNode({
      label: "old-capture", content: "{}", type: "note", importance: 0.8,
      metadata: { customType: "middle-term", sessionId: "old", timestamp: oldTimestamp },
    });
    await store.createNode({
      label: "recent-capture", content: "{}", type: "note", importance: 0.8,
      metadata: { customType: "middle-term", sessionId: "recent", timestamp: Date.now() },
    });
    const result = await cleanupMiddleTermCaptures(store, 30);
    expect(result).toBe(1);
  });
});
