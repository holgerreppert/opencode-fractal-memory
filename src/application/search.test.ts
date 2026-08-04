import { describe, expect, test } from "bun:test";
import { searchNodes } from "./search";
import type { MemoryStore, MemoryNode } from "../domain/ports/MemoryStore";

const EMB = Array.from({ length: 384 }, () => 0.01);

function node(id: string, label = "seed"): MemoryNode {
  return { id, label, content: "test content", scope: "project" } as MemoryNode;
}

interface MockCalls {
  searchByEmbedding: number;
  searchBM25: number;
  searchText: number;
}

function makeStore(overrides?: Partial<MemoryStore>): { store: MemoryStore; calls: MockCalls } {
  const calls: MockCalls = { searchByEmbedding: 0, searchBM25: 0, searchText: 0 };
  const store = {
    searchByEmbedding: async () => { calls.searchByEmbedding++; return [node("e1")]; },
    searchBM25: async () => { calls.searchBM25++; return [node("b1")]; },
    searchText: async () => { calls.searchText++; return [node("t1")]; },
    ...overrides,
  } as unknown as MemoryStore;
  return { store, calls };
}

describe("searchNodes facade", () => {
  test("defaults to hybrid mode (embed → searchByEmbedding)", async () => {
    let embedCalled = 0;
    const { store, calls } = makeStore();
    const results = await searchNodes(store, async () => { embedCalled++; return EMB; }, "query");
    expect(embedCalled).toBe(1);
    expect(calls.searchByEmbedding).toBe(1);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("bm25 mode never calls embed, uses store.searchBM25", async () => {
    let embedCalled = 0;
    const { store, calls } = makeStore();
    const results = await searchNodes(store, async () => { embedCalled++; return EMB; }, "query", { mode: "bm25" });
    expect(embedCalled).toBe(0);
    expect(calls.searchByEmbedding).toBe(0);
    expect(calls.searchBM25).toBe(1);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("text mode never calls embed, uses store.searchText", async () => {
    let embedCalled = 0;
    const { store, calls } = makeStore();
    await searchNodes(store, async () => { embedCalled++; return EMB; }, "query", { mode: "text" });
    expect(embedCalled).toBe(0);
    expect(calls.searchText).toBe(1);
    expect(calls.searchByEmbedding).toBe(0);
  });

  test("hybrid falls back to BM25 when embed throws", async () => {
    const { store, calls } = makeStore();
    const failing = async (): Promise<number[]> => { throw new Error("no model"); };
    const results = await searchNodes(store, failing, "query", { mode: "hybrid" });
    expect(calls.searchByEmbedding).toBe(0);
    expect(calls.searchBM25).toBe(1);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("hybrid falls back to BM25 when embed returns empty", async () => {
    const { store, calls } = makeStore();
    const empty = async (): Promise<number[]> => [];
    await searchNodes(store, empty, "query", { mode: "hybrid" });
    expect(calls.searchByEmbedding).toBe(0);
    expect(calls.searchBM25).toBe(1);
  });

  test("passes through filters/rrf/temporal options to searchByEmbedding", async () => {
    let capturedOpts: unknown;
    const store = makeStore({
      searchByEmbedding: async (_q: number[], _l: number, opts: unknown) => { capturedOpts = opts; return [node("e1")]; },
    }).store;
    await searchNodes(store, async () => EMB, "query", {
      mode: "hybrid",
      limit: 7,
      minLevel: 1,
      maxLevel: 5,
      rrfK: 40,
      minUsefulness: 0.5,
      intent: "debug",
      categoryFilter: "semantic",
      projectName: "proj",
      rerank: false,
      tagsFilter: ["a"],
    });
    const opts = capturedOpts as Record<string, unknown>;
    expect(opts["queryText"]).toBe("query");
    expect(opts["rerank"]).toBe(false);
    expect(opts["minLevel"]).toBe(1);
    expect(opts["maxLevel"]).toBe(5);
    expect(opts["rrfK"]).toBe(40);
    expect(opts["minUsefulness"]).toBe(0.5);
    expect(opts["projectName"]).toBe("proj");
    expect(opts["intent"]).toBe("debug");
    expect(opts["categoryFilter"]).toBe("semantic");
    expect(opts["tagsFilter"]).toEqual(["a"]);
  });
});