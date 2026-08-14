import { describe, expect, test, beforeEach } from "bun:test";
import { createCompactionHandler } from "./compaction";
import { clearWorkingCache } from "../../application/cache";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";

function makeStore(): MemoryStore & { created: Array<Record<string, unknown>> } {
  const store = {} as MemoryStore & { created: Array<Record<string, unknown>> };
  store.created = [];
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
  store.recordTokenUsage = async () => {};
  return store;
}

const CONFIG = { enableMiddleTermCapture: true } as MemConfig;

beforeEach(() => {
  clearWorkingCache("compact-s1");
  clearWorkingCache("compact-s2");
});

describe("createCompactionHandler capture caps", () => {
  test("excludes middle-term/storedcontext from fallback fill and caps capture size", async () => {
    const store = makeStore();
    const handler = createCompactionHandler(store, CONFIG, {} as any);
    const compact = handler["compacting"]!;

    const output = { context: [] as string[] };
    await compact({ sessionID: "compact-s1" } as any, output as any);

    expect(store.created.length).toBeGreaterThanOrEqual(1);
    const middleTerm = store.created.find(n => String(n.label).startsWith("middle-term:"))!;
    expect(middleTerm).toBeDefined();

    const parsed = JSON.parse(String(middleTerm.content));
    expect(parsed.workingCache.length).toBe(1);
    expect(parsed.workingCache[0].label).toBe("old:snapshot");
    expect(parsed.workingCache.some((e: any) => String(e.label).startsWith("middle-term:"))).toBe(false);
    expect(parsed.workingCache.some((e: any) => String(e.label).startsWith("storedcontext:"))).toBe(false);
  });

  test("caps per-entry content to 2000 chars and total to 12000", async () => {
    const store = makeStore();
    const handler = createCompactionHandler(store, CONFIG, {} as any);
    const compact = handler["compacting"]!;

    // Prime the cache directly by invoking through fallback exclusion: build a fake
    // session client-less run, then verify no oversized entries ever appear.
    const output = { context: [] as string[] };
    await compact({ sessionID: "compact-s2" } as any, output as any);

    const middleTerm = store.created.find(n => String(n.label).startsWith("middle-term:"))!;
    const parsed = JSON.parse(String(middleTerm.content));
    for (const entry of parsed.workingCache) {
      expect(entry.content.length).toBeLessThanOrEqual(2_000);
    }
    expect(String(middleTerm.content).length).toBeLessThanOrEqual(12_000);
  });
});