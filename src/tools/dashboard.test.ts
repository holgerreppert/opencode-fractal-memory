import { describe, expect, test } from "bun:test";
import { MemoryDashboard } from "./dashboard";
import type { MemoryStore } from "../storage/sqlite";
import type { FractalStats } from "../storage/types";

function makeMockStore(nodes: Record<string, unknown>[], stats?: Partial<FractalStats>): MemoryStore {
  return {
    listNodes: async () => nodes.map((n, i) => ({
      id: `node-${i}`,
      scope: "project",
      label: n.label as string ?? `Node ${i}`,
      content: "test",
      summary: null,
      level: (n.level as number) ?? 0,
      parentIds: null,
      embedding: n.embedding as number[] | null ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      importance: n.importance as number ?? 0.5,
      accessCount: n.accessCount as number ?? 0,
      lastAccessed: null,
      type: (n.type as string | null) ?? null,
      metadata: null,
      sticky: n.sticky as boolean ?? false,
      confidence: 0,
      lastVerified: null,
      usefulnessScore: n.usefulnessScore as number ?? 0,
      timesUsed: n.timesUsed as number ?? 0,
      timesHelpful: n.timesHelpful as number ?? 0,
    })),
    getFractalStats: async () => ({
      totalNodes: nodes.length,
      nodesPerLevel: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      compressionRatios: { 0: 9, 1: 0, 2: 0, 3: 0, 4: 0 },
      fractalDimension: 0,
      avgChildrenPerNode: 0,
      treeDepth: 0,
      hasEmbeddings: nodes.filter(n => n.embedding).length,
      scopes: { global: 0, project: nodes.length },
      ...stats,
    }),
    logToolCall: async () => {},
    pruneUsageLog: async () => 0,
    ensureSeed: async () => {},
    getNode: async () => { throw new Error("not used"); },
    getNodeByPrefix: async () => null,
    getNodeByLabel: async () => { throw new Error("not used"); },
    createNode: async () => { throw new Error("not used"); },
    updateNode: async () => {},
    deleteNode: async () => {},
    runCompression: async () => ({ compressed: 0, created: 0 }),
    runPatternExtraction: async () => ({ created: 0, sources: 0 }),
    getCompressionCandidates: async () => [],
    retrieveFractal: async () => ({ node: null as any, path: [], depth: 0, relevanceScore: 0 }),
    detectTopicBoundaries: async () => [],
    drilldownQuery: async () => [],
    verifyNode: async () => { throw new Error("not used"); },
    calculateNodeConfidence: () => 0,
    getConfig: async () => "",
    setConfig: async () => {},
    getToolPatterns: async () => [],
    getFrequentSequences: async () => [],
    runScoreDecay: async () => 0,
    pruneNodes: async () => ({ prunable: [], pruned: 0 }),
    storeLinks: async () => {},
    getLinkedNodes: async () => [],
    backfillLinks: async () => {},
    updateLinksForNewNode: async () => {},
    backfillBinaryEmbeddingsAndBM25: async () => {},
    rebuildHNSWIndex: async () => {},
    logInjectionMetrics: async () => {},
    recordMemoryToolCall: async () => {},
    finalizeInjection: async () => {},
    recordInjectionFeedback: async () => {},
    getInjectionMetrics: async () => [],
    getSessionStats: async () => null,
    recordAgentToolCall: async () => {},
    createSessionMetrics: async () => {},
    updateSessionMetrics: async () => {},
    incrementSessionToolCall: async () => {},
    getSessionMetrics: async () => null,
    getPendingInjections: async () => [],
    markInjectionProcessed: async () => {},
    close: async () => {},
  } as unknown as MemoryStore;
}

const defaultStats = {
  fractalDimension: 0.85,
  treeDepth: 3,
  avgChildrenPerNode: 2.1,
};

describe("MemoryDashboard", () => {
  test("empty scope returns no nodes message", async () => {
    const tool = MemoryDashboard(makeMockStore([]));
    const result = await (tool as any).execute({ scope: "project", limit: 10 });
    expect(result).toContain("No nodes found");
  });

  test("respects limit parameter", async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      label: `Node ${i}`,
      accessCount: 20 - i,
    }));
    const tool = MemoryDashboard(makeMockStore(nodes, defaultStats));
    const result = await (tool as any).execute({ scope: "all", limit: 5 });
    const rows = result.match(/\| \d+ \| Node/g);
    expect(rows).toHaveLength(5);
  });

  test("shows type distribution with mixed types", async () => {
    const nodes = [
      { type: "note", accessCount: 1 },
      { type: "note", accessCount: 1 },
      { type: "core", accessCount: 1 },
      { type: "summary", accessCount: 1 },
    ];
    const tool = MemoryDashboard(makeMockStore(nodes, defaultStats));
    const result = await (tool as any).execute({ scope: "all" });
    expect(result).toContain("| note | 2 |");
    expect(result).toContain("| core | 1 |");
    expect(result).toContain("| summary | 1 |");
  });

  test("show_tree_depth: false omits tree depth line", async () => {
    const nodes = [{ label: "test", accessCount: 1 }];
    const tool = MemoryDashboard(makeMockStore(nodes, defaultStats));
    const result = await (tool as any).execute({ show_tree_depth: false });
    expect(result).not.toContain("Tree depth");
    expect(result).toContain("Fractal dimension");
  });

  test("show_embedding_coverage: false omits embeddings line", async () => {
    const nodes = [{ label: "test", accessCount: 1 }];
    const tool = MemoryDashboard(makeMockStore(nodes, defaultStats));
    const result = await (tool as any).execute({ show_embedding_coverage: false });
    expect(result).not.toContain("Nodes with embeddings");
  });

  test("most useful section only shows nodes with >0 usefulness", async () => {
    const nodes = [
      { label: "useful", accessCount: 1, usefulnessScore: 2.5, timesUsed: 5, timesHelpful: 2 },
      { label: "neutral", accessCount: 2, usefulnessScore: 0, timesUsed: 3, timesHelpful: 0 },
      { label: "useless", accessCount: 3, usefulnessScore: 0, timesUsed: 0, timesHelpful: 0 },
    ];
    const tool = MemoryDashboard(makeMockStore(nodes, defaultStats));
    const result = await (tool as any).execute({ scope: "all" });
    expect(result).toContain("useful");
    expect(result).not.toContain("| neutral | 0.0 | 3 | 0 |");
  });

  test("compression ratios render correctly", async () => {
    const nodes = [{ label: "test", accessCount: 1 }];
    const stats = {
      ...defaultStats,
      compressionRatios: { 0: 12.5, 1: 3.2, 2: 0, 3: 0, 4: 0 },
    };
    const tool = MemoryDashboard(makeMockStore(nodes, stats));
    const result = await (tool as any).execute({ scope: "all" });
    expect(result).toContain("12.5x");
    expect(result).toContain("3.2x");
  });
});
