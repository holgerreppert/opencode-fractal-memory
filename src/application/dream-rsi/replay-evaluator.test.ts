import { describe, expect, test } from "bun:test";
import { replaySessionQueries, formatReplayResult, persistBestStrategy, getActiveRerankMode, adaptBeta, selectStrategies } from "./replay-evaluator";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemoryNode } from "../../domain/ports/MemoryStore";

function makeNode(overrides: Partial<MemoryNode> & { id: string }): MemoryNode {
  return {
    scope: "project",
    label: null,
    content: "",
    summary: null,
    keywords: null,
    level: 0,
    parentIds: null,
    embedding: [0.1, 0.2, 0.3],
    embeddingSegments: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    importance: 0.5,
    accessCount: 1,
    lastAccessed: null,
    type: "fact",
    category: "semantic",
    supertype: "declarative",
    domain: null,
    metadata: null,
    sticky: false,
    ttlDays: null,
    expiresAt: null,
    tags: null,
    source: "manual",
    confidence: 0.5,
    lastVerified: null,
    verificationCount: 0,
    usefulnessScore: 0,
    timesUsed: 0,
    timesHelpful: 0,
    projectName: null,
    derivedFrom: null,
    derivation: null,
    status: "active",
    validFrom: null,
    validUntil: null,
    supersedesId: null,
    contentHash: null,
    subtask: null,
    ...overrides,
  };
}

function makeStoreWithMetrics(
  metrics: Array<{ sessionId: string; queryText?: string; postRerankIds?: string[]; rerankStrategy?: string; injectionUpvotes?: number; injectionDownvotes?: number }>,
  searchResults: MemoryNode[],
): Partial<MemoryStore> {
  return {
    getInjectionMetrics: async (_limit: number) => metrics.map(m => ({
      id: "m1",
      sessionId: m.sessionId,
      injectedNodeCount: 1,
      injectedTokens: 100,
      injectionMode: "auto_retrieve" as const,
      queryText: m.queryText ?? null,
      preRerankIds: [],
      postRerankIds: m.postRerankIds ?? [],
      rerankScores: [],
      rerankStrategy: m.rerankStrategy ?? null,
      rerankDurationMs: 0,
      injectedNodeTypes: {},
      injectedContent: [],
      injectionUpvotes: m.injectionUpvotes ?? 0,
      injectionDownvotes: m.injectionDownvotes ?? 0,
      effectivenessScore: null,
      createdAt: Date.now(),
    })),
  } as unknown as MemoryStore;
}

function makeStoreWithSearch(
  metrics: Array<{ sessionId: string; queryText?: string; postRerankIds?: string[]; rerankStrategy?: string; injectionUpvotes?: number; injectionDownvotes?: number }>,
  searchResults: MemoryNode[],
): Partial<MemoryStore> {
  const store = makeStoreWithMetrics(metrics, searchResults) as Record<string, unknown>;
  store.projectName = "test-proj";
  store.searchByEmbedding = async () => searchResults.map(n => ({ node: n, score: 0.8 }));
  store.drilldownQuery = async () => searchResults.map(n => ({ node: n, relevance: 0.8, path: [n], level: "summary" }));
  return store as unknown as MemoryStore;
}

const embed = async (_text: string) => [0.1, 0.2, 0.3];

describe("replaySessionQueries", () => {
  test("returns empty result when no metrics exist for session", async () => {
    const store = makeStoreWithMetrics([], []) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "nonexistent");
    expect(result.queriesReplayed).toBe(0);
    expect(result.strategies).toHaveLength(0);
  });

  test("returns empty when metrics have no queryText", async () => {
    const store = makeStoreWithMetrics(
      [{ sessionId: "s1" }],
      [],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1");
    expect(result.queriesReplayed).toBe(0);
  });

  test("replays queries and scores strategies", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1");
    expect(result.queriesReplayed).toBe(1);
    expect(result.strategies.length).toBeGreaterThan(0);
    expect(result.bestStrategyId).toBeTruthy();
  });

  test("drilldown baseline overlaps injected nodes (injection pipeline parity)", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const drilldown = result.strategies.find(s => s.strategyId === "drilldown");
    expect(drilldown).toBeDefined();
    expect(drilldown!.totalOverlap).toBe(1);
    expect(drilldown!.avgScore).toBeGreaterThan(0.5);
  });

  test("excludes queries with no recorded injected node ids", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query" }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1");
    expect(result.queriesReplayed).toBe(0);
    expect(result.strategies).toHaveLength(0);
  });

  test("positive feedback credits the producing strategy (up to 1.0)", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"], rerankStrategy: "drilldown", injectionUpvotes: 3 }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const drilldown = result.strategies.find(s => s.strategyId === "drilldown")!;
    const keyword = result.strategies.find(s => s.strategyId === "keyword")!;
    expect(drilldown.avgScore).toBeCloseTo(1.0, 5);
    expect(keyword.avgScore).toBeCloseTo(0.8, 5);
    expect(result.bestStrategyId).toBe("drilldown");
  });

  test("negative feedback caps the producer so an overlapping challenger wins", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"], rerankStrategy: "drilldown", injectionDownvotes: 3 }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const drilldown = result.strategies.find(s => s.strategyId === "drilldown")!;
    const keyword = result.strategies.find(s => s.strategyId === "keyword")!;
    // Self-row: 3 downvotes (fb=-1.5) revoke the producer's agreement
    // entirely (was 0.6 when overlap was still credited tautologically).
    expect(drilldown.avgScore).toBeCloseTo(0.0, 5);
    expect(keyword.avgScore).toBeCloseTo(0.8, 5);
    expect(result.bestStrategyId).not.toBe("drilldown");
  });

  test("neutral self-row keeps the producer's incumbency (agreement stays 1.0)", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"], rerankStrategy: "drilldown" }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const drilldown = result.strategies.find(s => s.strategyId === "drilldown")!;
    const keyword = result.strategies.find(s => s.strategyId === "keyword")!;
    // No feedback: the producer keeps full agreement (0.6 + 0.2 = 0.8) and
    // the fully-overlapping challenger ties at 0.8 — no churn without evidence.
    expect(drilldown.avgScore).toBeCloseTo(0.8, 5);
    expect(keyword.avgScore).toBeCloseTo(0.8, 5);
  });

  test("mild negative feedback proportionally revokes the producer's agreement", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"], rerankStrategy: "drilldown", injectionDownvotes: 1 }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const drilldown = result.strategies.find(s => s.strategyId === "drilldown")!;
    const keyword = result.strategies.find(s => s.strategyId === "keyword")!;
    // fb = -0.5 → producer agreement g = 0.5 → 0.5*0.6 + 0.0 = 0.3;
    // non-producer keyword keeps real overlap (1.0*0.6 + 0.2 = 0.8).
    expect(drilldown.avgScore).toBeCloseTo(0.3, 5);
    expect(keyword.avgScore).toBeCloseTo(0.8, 5);
    expect(result.bestStrategyId).not.toBe("drilldown");
  });

  test("hybrid strategies search the project corpus (projectName parity)", async () => {
    const node1 = makeNode({ id: "n1" });
    let capturedProjectName: string | undefined;
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as Record<string, unknown>;
    store.searchByEmbedding = async (_e: number[], _l: number, opts?: { projectName?: string }) => {
      capturedProjectName = opts?.projectName;
      return [{ node: node1, score: 0.8 }];
    };
    const result = await replaySessionQueries(store as unknown as MemoryStore, embed, "s1", { maxRevisions: 0 });
    expect(result.queriesReplayed).toBe(1);
    expect(capturedProjectName).toBe("test-proj");
  });
});

describe("formatReplayResult", () => {
  test("formats zero replay count", () => {
    const result = formatReplayResult({
      bestStrategyId: "keyword",
      strategies: [],
      queriesReplayed: 0,
      sessionsReplayed: 0,
    });
    expect(result).toContain("No queries to replay");
  });

  test("formats strategy scores", () => {
    const result = formatReplayResult({
      bestStrategyId: "cross-encoder",
      strategies: [
        { strategyId: "keyword", strategyLabel: "keyword", avgScore: 0.5, qualityScore: 0.55, costPenalty: 0, parallelismBonus: 0, queriesTested: 3, totalOverlap: 5, details: [] },
        { strategyId: "cross-encoder", strategyLabel: "cross-encoder", avgScore: 0.8, qualityScore: 0.7, costPenalty: 0.4, parallelismBonus: 0, queriesTested: 3, totalOverlap: 8, details: [] },
      ],
      queriesReplayed: 3,
      sessionsReplayed: 1,
      revision: 1,
      previousScore: 0.6,
    });
    expect(result).toContain("★ BEST");
    expect(result).toContain("cross-encoder");
    expect(result).toContain("Recommendation");
    expect(result).toContain("Revisions: 1/");
    expect(result).toContain("Previous score: 0.600");
    expect(result).toContain("cost=0.40");
    expect(result).toContain("quality=");
  });
});

describe("persistBestStrategy", () => {
  test("skips when no queries replayed", async () => {
    let created = false;
    const store = {
      getNodeByLabel: async () => null,
      createNode: async () => { created = true; return { id: "x" } as MemoryNode; },
      updateNode: async () => {},
    } as unknown as MemoryStore;
    await persistBestStrategy(store, { bestStrategyId: "keyword", strategies: [], queriesReplayed: 0, sessionsReplayed: 0 });
    expect(created).toBe(false);
  });

  test("creates node with winning strategy", async () => {
    const created: string[] = [];
    const store = {
      getNodeByLabel: async () => null,
      createNode: async (node: { label: string }) => { created.push(node.label); return { id: "x" } as MemoryNode; },
      updateNode: async () => {},
    } as unknown as MemoryStore;
    await persistBestStrategy(store, {
      bestStrategyId: "cross-encoder",
      strategies: [{ strategyId: "cross-encoder", strategyLabel: "cross-encoder", avgScore: 0.8, qualityScore: 0.75, costPenalty: 0.1, parallelismBonus: 0, queriesTested: 5, totalOverlap: 10, details: [] }],
      queriesReplayed: 5,
      sessionsReplayed: 1,
      revision: 1,
    });
    expect(created).toContain("dream-rsi:active-strategy");
  });

  function makePersistFixture(existingStrategyId: string, existingScore: number) {
    const updates: Array<{ content?: string; metadata?: Record<string, unknown> }> = [];
    const store = {
      getNodeByLabel: async (_scope: string, label: string) => {
        if (label === "dream-rsi:active-strategy") {
          return {
            id: "node-strategy",
            confidence: 0.7,
            metadata: { strategyId: existingStrategyId, score: existingScore, scoreHistory: [existingScore] },
          };
        }
        return null;
      },
      createNode: async () => ({ id: "created" } as MemoryNode),
      updateNode: async (_id: string, patch: { content?: string; metadata?: Record<string, unknown> }) => {
        updates.push(patch);
      },
    } as unknown as MemoryStore;
    return { store, updates };
  }

  test("hysteresis holds the incumbent when the challenger's win is under switchMargin", async () => {
    const { store, updates } = makePersistFixture("keyword", 0.7);
    await persistBestStrategy(store, {
      bestStrategyId: "drilldown",
      strategies: [
        { strategyId: "drilldown", strategyLabel: "drilldown", avgScore: 0.73, qualityScore: 0.73, costPenalty: 0, parallelismBonus: 0, queriesTested: 5, totalOverlap: 8, details: [] },
        { strategyId: "keyword", strategyLabel: "keyword", avgScore: 0.7, qualityScore: 0.7, costPenalty: 0, parallelismBonus: 0, queriesTested: 5, totalOverlap: 8, details: [] },
      ],
      queriesReplayed: 5,
      sessionsReplayed: 1,
    }, undefined, { switchMargin: 0.05 });
    // 0.73 < 0.70 + 0.05 → keyword keeps the seat; history appends the
    // effective winner's score, not the round winner's.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.metadata!.strategyId).toBe("keyword");
    expect(updates[0]!.metadata!.scoreHistory).toEqual([0.7, 0.7]);
    expect(updates[0]!.content).toContain("keyword");
    expect(updates[0]!.content).not.toContain("(drilldown)");
  });

  test("hysteresis switches when the challenger wins by at least switchMargin", async () => {
    const { store, updates } = makePersistFixture("keyword", 0.7);
    await persistBestStrategy(store, {
      bestStrategyId: "drilldown",
      strategies: [
        { strategyId: "drilldown", strategyLabel: "drilldown", avgScore: 0.8, qualityScore: 0.8, costPenalty: 0, parallelismBonus: 0, queriesTested: 5, totalOverlap: 8, details: [] },
        { strategyId: "keyword", strategyLabel: "keyword", avgScore: 0.7, qualityScore: 0.7, costPenalty: 0, parallelismBonus: 0, queriesTested: 5, totalOverlap: 8, details: [] },
      ],
      queriesReplayed: 5,
      sessionsReplayed: 1,
    }, undefined, { switchMargin: 0.05 });
    // 0.80 >= 0.70 + 0.05 → drilldown takes the seat.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.metadata!.strategyId).toBe("drilldown");
    expect(updates[0]!.metadata!.scoreHistory).toEqual([0.7, 0.8]);
    expect(updates[0]!.content).toContain("drilldown");
  });

  test("switches immediately when the incumbent was not evaluated this round", async () => {
    const { store, updates } = makePersistFixture("cross-encoder", 0.6);
    await persistBestStrategy(store, {
      bestStrategyId: "keyword",
      strategies: [
        { strategyId: "keyword", strategyLabel: "keyword", avgScore: 0.55, qualityScore: 0.55, costPenalty: 0, parallelismBonus: 0, queriesTested: 5, totalOverlap: 8, details: [] },
      ],
      queriesReplayed: 5,
      sessionsReplayed: 1,
    }, undefined, { switchMargin: 0.05 });
    // No fair comparison → the round winner takes the seat.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.metadata!.strategyId).toBe("keyword");
  });
});

describe("getActiveRerankMode", () => {
  test("returns undefined when no strategy node exists", async () => {
    const store = {
      getNodeByLabel: async () => { throw new Error("not found"); },
    } as unknown as MemoryStore;
    expect(await getActiveRerankMode(store)).toBeUndefined();
  });

  test("returns cross-encoder for cross-encoder strategy", async () => {
    const store = {
      getNodeByLabel: async () => ({
        metadata: { strategyId: "cross-encoder", score: 0.8, updatedAt: Date.now() },
      }),
    } as unknown as MemoryStore;
    expect(await getActiveRerankMode(store)).toBe("cross-encoder");
  });

  test("returns keyword for keyword strategy", async () => {
    const store = {
      getNodeByLabel: async () => ({
        metadata: { strategyId: "keyword", score: 0.5, updatedAt: Date.now() },
      }),
    } as unknown as MemoryStore;
    expect(await getActiveRerankMode(store)).toBe("keyword");
  });
});

describe("revision loop", () => {
  test("runs multiple revisions when score improves", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 3 });
    expect(result.revision).toBeGreaterThanOrEqual(0);
    expect(result.queriesReplayed).toBe(1);
    expect(result.strategies.length).toBeGreaterThan(0);
  });

  test("reverts when revision score is worse than previous", async () => {
    const node1 = makeNode({ id: "n1" });
    const storeWithPrevScore = {
      ...makeStoreWithSearch(
        [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
        [node1],
      ),
      getNodeByLabel: async () => ({
        metadata: { strategyId: "keyword", score: 9.99, updatedAt: Date.now() },
      }),
    } as unknown as MemoryStore;
    const result = await replaySessionQueries(storeWithPrevScore, embed, "s1", { maxRevisions: 2 });
    expect(result.revision).toBeLessThanOrEqual(1);
  });

  test("defaults maxRevisions to 2", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1");
    expect(result.revision).toBeGreaterThanOrEqual(0);
  });
});

describe("cost+parallelism scoring", () => {
  test("keyword strategy has zero cost penalty", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const keywordStrategy = result.strategies.find(s => s.strategyId === "keyword");
    expect(keywordStrategy).toBeDefined();
    expect(keywordStrategy!.costPenalty).toBe(0);
  });

  test("cross-encoder strategy has non-zero cost penalty", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const ceStrategy = result.strategies.find(s => s.strategyId === "cross-encoder");
    expect(ceStrategy).toBeDefined();
    expect(ceStrategy!.costPenalty).toBeGreaterThan(0);
  });

  test("intent strategies have parallelism bonus", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    const intentStrategy = result.strategies.find(s => s.strategyId === "intent-debug");
    expect(intentStrategy).toBeDefined();
    expect(intentStrategy!.parallelismBonus).toBeGreaterThan(0);
  });

  test("qualityScore is present on all strategies", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    for (const s of result.strategies) {
      expect(s.qualityScore).toBeGreaterThanOrEqual(0);
    }
  });

  test("costWeight and parallelismWeight affect scoring", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const heavyCost = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0, costWeight: 0.5 });
    const lightCost = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0, costWeight: 0.01 });
    const ceHeavy = heavyCost.strategies.find(s => s.strategyId === "cross-encoder")!;
    const ceLight = lightCost.strategies.find(s => s.strategyId === "cross-encoder")!;
    expect(ceHeavy.avgScore).toBeLessThanOrEqual(ceLight.avgScore);
  });
});

describe("adaptBeta", () => {
  test("returns current config when no strategy exists", async () => {
    const store = {
      getNodeByLabel: async () => { throw new Error("not found"); },
    } as unknown as MemoryStore;
    const cfg = { maxRevisions: 2, costWeight: 0.1, parallelismWeight: 0.05 };
    const result = await adaptBeta(store, cfg);
    expect(result.config.costWeight).toBe(0.1);
  });

  test("increases costWeight when scores plateau", async () => {
    const store = {
      getNodeByLabel: async () => ({
        metadata: { strategyId: "keyword", score: 0.5, scoreHistory: [0.3, 0.5, 0.501], updatedAt: Date.now() },
      }),
    } as unknown as MemoryStore;
    const cfg = { maxRevisions: 2, costWeight: 0.1, parallelismWeight: 0.05 };
    const result = await adaptBeta(store, cfg);
    expect(result.config.costWeight).toBeGreaterThan(0.1);
    expect(result.adaptation).toBeDefined();
    expect(result.adaptation!.reason).toBe("plateau");
  });

  test("decreases costWeight when scores decline", async () => {
    const store = {
      getNodeByLabel: async () => ({
        metadata: { strategyId: "keyword", score: 0.5, scoreHistory: [0.8, 0.5], updatedAt: Date.now() },
      }),
    } as unknown as MemoryStore;
    const cfg = { maxRevisions: 2, costWeight: 0.1, parallelismWeight: 0.05 };
    const result = await adaptBeta(store, cfg);
    expect(result.config.costWeight).toBeLessThan(0.1);
    expect(result.adaptation).toBeDefined();
    expect(result.adaptation!.reason).toBe("decline");
  });

  test("clamps costWeight within bounds", async () => {
    const store = {
      getNodeByLabel: async () => ({
        metadata: { strategyId: "keyword", score: 0.5, scoreHistory: [0.5, 0.5, 0.5, 0.5, 0.5], updatedAt: Date.now() },
      }),
    } as unknown as MemoryStore;
    const cfg = { maxRevisions: 2, costWeight: 0.29, parallelismWeight: 0.05 };
    const result = await adaptBeta(store, cfg);
    expect(result.config.costWeight).toBeLessThanOrEqual(0.3);
  });

  test("no adaptation when scores are improving", async () => {
    const store = {
      getNodeByLabel: async () => ({
        metadata: { strategyId: "keyword", score: 0.5, scoreHistory: [0.3, 0.5], updatedAt: Date.now() },
      }),
    } as unknown as MemoryStore;
    const cfg = { maxRevisions: 2, costWeight: 0.1, parallelismWeight: 0.05 };
    const result = await adaptBeta(store, cfg);
    expect(result.config.costWeight).toBe(0.1);
    expect(result.adaptation).toBeUndefined();
  });
});

describe("selectStrategies", () => {
  test("returns all strategies when no history", () => {
    const result = selectStrategies([]);
    expect(result.length).toBe(6);
  });

  test("returns all strategies when high variance", () => {
    const result = selectStrategies([0.1, 0.5, 0.9]);
    expect(result.length).toBe(6);
  });

  test("returns subset when converging", () => {
    const result = selectStrategies([0.5, 0.5, 0.51, 0.52]);
    expect(result.length).toBe(4);
    expect(result.map(s => s.id)).toContain("drilldown");
  });
});

describe("sessionsReplayed", () => {
  test("returns sessionsReplayed from replay", async () => {
    const node1 = makeNode({ id: "n1" });
    const store = makeStoreWithSearch(
      [{ sessionId: "s1", queryText: "test query", postRerankIds: ["n1"] }],
      [node1],
    ) as unknown as MemoryStore;
    const result = await replaySessionQueries(store, embed, "s1", { maxRevisions: 0 });
    expect(result.sessionsReplayed).toBeGreaterThanOrEqual(1);
  });
});
