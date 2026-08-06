import { describe, expect, test } from "bun:test";
import { captureSessionWork } from "./work-capture";
import type { MemoryStore } from "../storage/sqlite";

const CONFIG = { enabled: true, minEdits: 1, useLlm: false, maxPerSession: 3 };

function makeEditCalls(n: number, toolName = "edit"): Array<{
  toolName: string; timestamp: number; toolCategory: string;
  filePath: string | null; command: string | null; success: boolean;
}> {
  return Array.from({ length: n }, (_, i) => ({
    toolName,
    timestamp: 1,
    toolCategory: "tool",
    filePath: `src/file${i}.ts`,
    command: null,
    success: true,
  }));
}

function makeStore(opts?: {
  edits?: number;
  existing?: boolean;
}): MemoryStore {
  const edits = opts?.edits ?? 3;
  const toolCalls = [
    ...makeEditCalls(edits),
    { toolName: "grep", timestamp: 1, toolCategory: "tool", filePath: null, command: null, success: true },
    { toolName: "edit", timestamp: 2, toolCategory: "tool", filePath: "src/failed.ts", command: null, success: false },
  ];
  const stats = {
    sessionId: "ses-x",
    startedAt: 1,
    endedAt: 2,
    status: "completed",
    totalToolCalls: toolCalls.length,
    fileReads: 1,
    fileEdits: edits,
    bashCommands: 0,
    memoryTools: 0,
    failedTools: 1,
    uniqueFilesTouched: toolCalls.map(t => t.filePath).filter(Boolean) as string[],
    injectionCount: 0,
    injectedTokens: 0,
    toolCalls,
  };
  const store = {
    getSessionStats: async () => stats,
    listNodes: async () => opts?.existing
      ? [{ label: "work:1", tags: ["sess:ses-x"] }]
      : [],
    createNode: async (node: Record<string, unknown>) => ({ label: node.label, id: "n1" }),
  } as unknown as MemoryStore;
  return store;
}

describe("captureSessionWork", () => {
  test("returns disabled when config enabled is false", async () => {
    const msg = await captureSessionWork(makeStore(), { ...CONFIG, enabled: false }, "ses-x");
    expect(msg).toContain("disabled");
  });

  test("skips when below minEdits", async () => {
    const msg = await captureSessionWork(makeStore({ edits: 0 }), { ...CONFIG, minEdits: 2 }, "ses-x");
    expect(msg).toContain("skipped");
    expect(msg).toContain("0 successful edits");
  });

  test("creates a knowledge work node with files and tools", async () => {
    let created: Record<string, unknown> | null = null;
    const store = makeStore({ edits: 2 }) as unknown as MemoryStore & {
      createNode: (n: Record<string, unknown>) => Promise<unknown>;
    };
    store.createNode = async (n: Record<string, unknown>) => { created = n; return { label: n.label }; };
    const msg = await captureSessionWork(store as unknown as MemoryStore, CONFIG, "ses-x");
    expect(msg).toContain("created");
    expect(created?.type).toBe("knowledge");
    expect(created?.source).toBe("auto_extract");
    expect((created?.label as string)).toStartWith("work:");
    expect((created?.tags as string[])).toContain("sess:ses-x");
    expect((created?.content as string)).toContain("src/file0.ts");
    expect((created?.content as string)).toContain("edit");
  });

  test("dedups: skips when session already captured at the cap", async () => {
    const msg = await captureSessionWork(makeStore({ existing: true }), { ...CONFIG, maxPerSession: 1 }, "ses-x");
    expect(msg).toContain("already has 1 work node(s)");
  });

  test("counts only successful edit tools, ignoring failures and reads", async () => {
    let created: Record<string, unknown> | null = null;
    const store = makeStore({ edits: 1 }) as unknown as MemoryStore & {
      createNode: (n: Record<string, unknown>) => Promise<unknown>;
    };
    store.createNode = async (n: Record<string, unknown>) => { created = n; return { label: n.label }; };
    const msg = await captureSessionWork(store as unknown as MemoryStore, CONFIG, "ses-x");
    expect(msg).toContain("1 edits");
    const meta = created?.metadata as { editCount: number };
    expect(meta.editCount).toBe(1);
    const content = created?.content as string;
    expect(content).not.toContain("src/failed.ts");
    expect(content).not.toContain("grep");
  });
});
