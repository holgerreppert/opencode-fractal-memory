import { describe, expect, test, beforeEach } from "bun:test";
import { createCompactionHandler } from "./compaction";
import { clearWorkingCache } from "../../application/cache";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";

function makeStore(): MemoryStore & { created: Array<Record<string, unknown>>; recordedTokens: Array<Record<string, unknown>> } {
  const store = {} as MemoryStore & { created: Array<Record<string, unknown>>; recordedTokens: Array<Record<string, unknown>> };
  store.created = [];
  store.recordedTokens = [];
  store.listNodes = async () => [
    { id: "a", label: "old:snapshot", content: "z".repeat(30_000), createdAt: new Date(Date.now() - 10_000) } as any,
    { id: "b", label: "middle-term:old", content: "y".repeat(30_000), createdAt: new Date(Date.now() - 5_000) } as any,
    { id: "c", label: "storedcontext:old", content: "x".repeat(30_000), createdAt: new Date(Date.now() - 2_000) } as any,
  ];
  store.createNode = async (node: any) => {
    store.created.push(node);
    return node;
  };
  store.logInjectionMetrics = async () => {};
  store.recordTokenUsage = async (entry: any) => {
    store.recordedTokens.push(entry);
  };
  return store;
}

const CONFIG = { enableMiddleTermCapture: true } as MemConfig;

beforeEach(() => {
  clearWorkingCache("compact-s1");
  clearWorkingCache("compact-s2");
});

describe("createCompactionHandler capture caps", () => {
  test("no longer creates middle-term/storedcontext capture nodes (migrated to contexthistory)", async () => {
    const store = makeStore();
    const handler = createCompactionHandler(store, CONFIG, {} as any);
    const compact = handler["compacting"]!;

    const output = { context: [] as string[] };
    await compact({ sessionID: "compact-s1" } as any, output as any);

    // Node capture was removed with the storedcontext retirement — the
    // compaction hook now only provides working-cache context + token usage.
    expect(store.created.length).toBe(0);
    expect(output.context.length).toBeGreaterThanOrEqual(1);
    expect(output.context.join("\n")).toContain("Working cache");
  });

  test("still records token usage from fetched messages", async () => {
    const store = makeStore();
    const handler = createCompactionHandler(store, CONFIG, {
      session: {
        messages: async () => [{
          info: { role: "assistant", tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 0, write: 0 } }, cost: 0.001 },
          parts: [],
        }],
      },
    } as any);
    const compact = handler["compacting"]!;

    const output = { context: [] as string[] };
    await compact({ sessionID: "compact-s2" } as any, output as any);

    expect(store.created.length).toBe(0);
    expect(store.recordedTokens.length).toBe(1);
    expect(store.recordedTokens[0]!.inputTokens).toBe(100);
  });
});