import { describe, expect, test } from "bun:test";
import { extractSessionLessons } from "./lesson-extraction";
import type { MemoryStore } from "../storage/sqlite";

const CONFIG = { enabled: true, minFailures: 2, useLlm: false };

function makeStore(opts?: {
  failures?: number;
  covered?: boolean;
  existing?: boolean;
}): MemoryStore {
  const failures = opts?.failures ?? 3;
  const toolCalls = Array.from({ length: failures }, (_, i) => ({
    toolName: i === 0 ? "edit" : "grep",
    timestamp: 1,
    toolCategory: "tool",
    filePath: i === 0 ? "src/a.ts" : null,
    command: null,
    success: false,
  }));
  const stats = {
    sessionId: "ses-x",
    startedAt: 1,
    endedAt: 2,
    status: "completed",
    totalToolCalls: failures + 5,
    fileReads: 1,
    fileEdits: 1,
    bashCommands: 1,
    memoryTools: 1,
    failedTools: failures,
    uniqueFilesTouched: ["src/a.ts"],
    injectionCount: 0,
    injectedTokens: 0,
    toolCalls,
  };
  const store = {
    getSessionStats: async () => stats,
    listNodes: async () => opts?.existing
      ? [{ label: "lesson:1", tags: ["sig:edit,grep"] }]
      : [],
    createNode: async (node: Record<string, unknown>) => ({ label: node.label, id: "n1" }),
  } as unknown as MemoryStore;
  return store;
}

describe("extractSessionLessons", () => {
  test("returns disabled when config enabled is false", async () => {
    const msg = await extractSessionLessons(makeStore(), { ...CONFIG, enabled: false }, "ses-x");
    expect(msg).toContain("disabled");
  });

  test("skips when below minFailures", async () => {
    const msg = await extractSessionLessons(makeStore({ failures: 1 }), CONFIG, "ses-x");
    expect(msg).toContain("skipped");
    expect(msg).toContain("1 failures");
  });

  test("creates a lesson node with type lesson and sig tag", async () => {
    let created: Record<string, unknown> | null = null;
    const store = makeStore() as unknown as MemoryStore & {
      createNode: (n: Record<string, unknown>) => Promise<unknown>;
    };
    store.createNode = async (n: Record<string, unknown>) => { created = n; return { label: n.label }; };
    const msg = await extractSessionLessons(store as unknown as MemoryStore, CONFIG, "ses-x");
    expect(msg).toContain("created");
    expect(created?.type).toBe("lesson");
    expect(created?.source).toBe("auto_extract");
    expect((created?.tags as string[])).toContain("sig:edit,grep");
    expect((created?.content as string)).toContain("edit");
  });

  test("dedups: skips when signature already covered by an existing lesson", async () => {
    const msg = await extractSessionLessons(makeStore({ existing: true }), CONFIG, "ses-x");
    expect(msg).toContain("already covered");
  });

  test("creates no lesson when there are zero failures", async () => {
    const stats = {
      sessionId: "ses-x", startedAt: 1, endedAt: 2, status: "completed",
      totalToolCalls: 5, fileReads: 0, fileEdits: 0, bashCommands: 0, memoryTools: 0,
      failedTools: 0, uniqueFilesTouched: [], injectionCount: 0, injectedTokens: 0,
      toolCalls: [],
    };
    const store = {
      getSessionStats: async () => stats,
      listNodes: async () => [],
      createNode: async () => ({ label: "x", id: "n1" }),
    } as unknown as MemoryStore;
    const msg = await extractSessionLessons(store, CONFIG, "ses-x");
    expect(msg).toContain("skipped");
  });
});