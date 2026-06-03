import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  insertToolUsageLog,
  queryToolPatterns,
  queryFrequentSequences,
  deleteUsageLog,
  getToolCategory,
} from "./tool-usage";
import { runMigrations } from "./migrations";

function setup() {
  const db = new Database(":memory:");
  runMigrations(db);
  return { db };
}

describe("insertToolUsageLog", () => {
  test("inserts a usage log entry", async () => {
    const { db } = setup();
    await insertToolUsageLog(db, "memory_search", 500, false, true, 100);

    const row = db.query("SELECT tool_name, result_tokens, success FROM memory_usage_log").get() as { tool_name: string; result_tokens: number; success: number } | null;
    expect(row).not.toBeNull();
    expect(row!.tool_name).toBe("memory_search");
    expect(row!.result_tokens).toBe(500);
    expect(row!.success).toBe(1);
  });

  test("inserts with context warning and failure", async () => {
    const { db } = setup();
    await insertToolUsageLog(db, "memory_list", 150000, true, false, 5000);

    const row = db.query("SELECT tool_name, context_warning, success, duration_ms FROM memory_usage_log").get() as { tool_name: string; context_warning: number; success: number; duration_ms: number } | null;
    expect(row).not.toBeNull();
    expect(row!.context_warning).toBe(1);
    expect(row!.success).toBe(0);
    expect(row!.duration_ms).toBe(5000);
  });

  test("inserts multiple entries", async () => {
    const { db } = setup();
    await insertToolUsageLog(db, "memory_search", 100, false, true, 10);
    await insertToolUsageLog(db, "memory_get", 200, false, true, 20);

    const count = db.query("SELECT COUNT(*) as cnt FROM memory_usage_log").get() as { cnt: number };
    expect(count.cnt).toBe(2);
  });
});

describe("queryToolPatterns", () => {
  test("groups and aggregates by tool name", async () => {
    const { db } = setup();
    await insertToolUsageLog(db, "memory_search", 100, false, true, 10);
    await insertToolUsageLog(db, "memory_search", 200, false, true, 20);
    await insertToolUsageLog(db, "memory_get", 300, true, false, 50);

    const patterns = queryToolPatterns(db);

    expect(patterns.length).toBeGreaterThanOrEqual(2);

    const search = patterns.find(p => p.toolName === "memory_search");
    expect(search).toBeDefined();
    expect(search!.count).toBe(2);

    const get = patterns.find(p => p.toolName === "memory_get");
    expect(get).toBeDefined();
    expect(get!.count).toBe(1);
  });

  test("returns empty when no logs", () => {
    const { db } = setup();
    const patterns = queryToolPatterns(db);
    expect(patterns).toEqual([]);
  });
});

describe("queryFrequentSequences", () => {
  test("detects tool sequences", async () => {
    const { db } = setup();
    for (let i = 0; i < 5; i++) {
      await insertToolUsageLog(db, "memory_search", 100, false, true, 10);
      await insertToolUsageLog(db, "memory_get", 100, false, true, 10);
    }

    const sequences = queryFrequentSequences(db, 3);

    const searchToGet = sequences.find(s => s.prev === "memory_search" && s.next === "memory_get");
    expect(searchToGet).toBeDefined();
    expect(searchToGet!.count).toBeGreaterThanOrEqual(3);
  });

  test("returns empty when no frequent sequences", async () => {
    const { db } = setup();
    await insertToolUsageLog(db, "memory_search", 100, false, true, 10);
    await insertToolUsageLog(db, "memory_get", 100, false, true, 10);

    const sequences = queryFrequentSequences(db, 5);
    expect(sequences).toHaveLength(0);
  });

  test("skips consecutive duplicate pairs", async () => {
    const { db } = setup();
    for (let i = 0; i < 5; i++) {
      await insertToolUsageLog(db, "memory_search", 100, false, true, 10);
    }

    const sequences = queryFrequentSequences(db, 3);
    const selfSequence = sequences.find(s => s.prev === "memory_search" && s.next === "memory_search");
    expect(selfSequence).toBeUndefined();
  });
});

describe("deleteUsageLog", () => {
  test("deletes old logs", async () => {
    const { db } = setup();
    await insertToolUsageLog(db, "old_tool", 100, false, true, 10);

    const deleted = await deleteUsageLog(db, -1);
    expect(deleted).toBe(1);
  });

  test("keeps recent logs within threshold", async () => {
    const { db } = setup();
    await insertToolUsageLog(db, "recent_tool", 100, false, true, 10);

    const deleted = await deleteUsageLog(db, 86400000);
    expect(deleted).toBe(0);
  });
});

describe("getToolCategory", () => {
  test("categorizes memory_ and journal_ tools", () => {
    expect(getToolCategory("memory_search")).toBe("memory");
    expect(getToolCategory("journal_write")).toBe("memory");
  });

  test("categorizes file tools", () => {
    expect(getToolCategory("read")).toBe("file");
    expect(getToolCategory("edit")).toBe("file");
    expect(getToolCategory("write")).toBe("file");
    expect(getToolCategory("glob")).toBe("file");
    expect(getToolCategory("grep")).toBe("file");
    expect(getToolCategory("search")).toBe("file");
  });

  test("categorizes shell tools", () => {
    expect(getToolCategory("bash")).toBe("shell");
    expect(getToolCategory("shell")).toBe("shell");
  });

  test("categorizes unknown tools as other", () => {
    expect(getToolCategory("unknown_tool")).toBe("other");
    expect(getToolCategory("weird")).toBe("other");
  });
});
