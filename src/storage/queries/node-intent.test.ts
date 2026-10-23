import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations";
import { parseIntentVector, bumpNodeIntentVector } from "./node-intent";

let db: Database;

function insertNode(id: string, metadata: Record<string, unknown> | null): void {
  const now = Date.now();
  db.run(
    "INSERT INTO memory_nodes (id, scope, label, content, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, "project", id, "content", now, now, metadata ? JSON.stringify(metadata) : null],
  );
}

function getMetadata(id: string): string | null {
  const row = db.query("SELECT metadata FROM memory_nodes WHERE id = ?").get(id) as { metadata: string | null } | null;
  return row?.metadata ?? null;
}

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("parseIntentVector", () => {
  test("reads the intentVector key from a metadata object", () => {
    expect(parseIntentVector({ intentVector: { debug: 2, plan: 1 } })).toEqual({ debug: 2, plan: 1 });
  });

  test("parses raw JSON text metadata", () => {
    expect(parseIntentVector('{"intentVector":{"verify":3}}')).toEqual({ verify: 3 });
  });

  test("returns {} for missing, malformed, or non-numeric entries", () => {
    expect(parseIntentVector(null)).toEqual({});
    expect(parseIntentVector(undefined)).toEqual({});
    expect(parseIntentVector("not json {")).toEqual({});
    expect(parseIntentVector([1, 2])).toEqual({});
    expect(parseIntentVector({ intentVector: "nope" })).toEqual({});
    expect(parseIntentVector({ intentVector: { debug: "2", plan: -1, verify: 0, reflect: NaN } })).toEqual({});
  });
});

describe("bumpNodeIntentVector", () => {
  test("creates a vector on a node with no metadata", async () => {
    insertNode("n1", null);
    const bumped = await bumpNodeIntentVector(db, ["n1"], "debug");
    expect(bumped).toBe(1);
    expect(parseIntentVector(JSON.parse(getMetadata("n1")!))).toEqual({ debug: 1 });
  });

  test("increments an existing dimension and adds new ones", async () => {
    insertNode("n1", { intentVector: { debug: 2 } });
    await bumpNodeIntentVector(db, ["n1"], "debug");
    await bumpNodeIntentVector(db, ["n1"], "plan");
    expect(parseIntentVector(JSON.parse(getMetadata("n1")!))).toEqual({ debug: 3, plan: 1 });
  });

  test("preserves sibling metadata keys", async () => {
    insertNode("n1", { totalCalls: 7, editCount: 2, intentVector: { verify: 1 } });
    await bumpNodeIntentVector(db, ["n1"], "verify");
    const meta = JSON.parse(getMetadata("n1")!) as Record<string, unknown>;
    expect(meta.totalCalls).toBe(7);
    expect(meta.editCount).toBe(2);
    expect(meta.intentVector).toEqual({ verify: 2 });
  });

  test("missing node ids are skipped, not errors", async () => {
    insertNode("n1", null);
    const bumped = await bumpNodeIntentVector(db, ["n1", "ghost"], "research");
    expect(bumped).toBe(1);
    expect(parseIntentVector(JSON.parse(getMetadata("n1")!))).toEqual({ research: 1 });
  });

  test("malformed metadata is replaced by a clean vector", async () => {
    const now = Date.now();
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["bad", "project", "bad", "content", now, now, "{not json"],
    );
    const bumped = await bumpNodeIntentVector(db, ["bad"], "implement");
    expect(bumped).toBe(1);
    expect(parseIntentVector(JSON.parse(getMetadata("bad")!))).toEqual({ implement: 1 });
  });

  test("empty id list is a no-op", async () => {
    expect(await bumpNodeIntentVector(db, [], "reflect")).toBe(0);
  });
});
