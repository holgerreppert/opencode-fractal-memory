import { describe, expect, test, mock } from "bun:test";
import { MemoryCacheStatus } from "./cache-status";
import type { MemoryStore } from "../storage/sqlite";

const dummyStore = {
  logToolCall: async () => {},
  pruneUsageLog: async () => 0,
  ensureSeed: async () => {},
  listNodes: async () => [],
  getNode: async () => { throw new Error("not used"); },
  getNodeByPrefix: async () => null,
  getNodeByLabel: async () => { throw new Error("not used"); },
  createNode: async () => { throw new Error("not used"); },
  updateNode: async () => {},
  deleteNode: async () => {},
  getFractalStats: async () => ({
    totalNodes: 0, nodesPerLevel: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    compressionRatios: {}, fractalDimension: 0, avgChildrenPerNode: 0,
    treeDepth: 0, hasEmbeddings: 0, scopes: { global: 0, project: 0 },
  }),
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
  createTemporalEdge: async () => ({ id: "", sourceNodeId: "", targetNodeId: "", edgeType: "", scope: "project", createdAt: 0, confidence: 1, metadata: null }),
  getTemporalEdges: async () => [],
  expandWithTemporalContext: async () => [],
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

describe("MemoryCacheStatus", () => {
  test("empty cache shows empty message", async () => {
    const tool = MemoryCacheStatus(dummyStore);
    const result = await (tool as any).execute({});
    expect(result).toContain("Cache is empty");
  });

  test("output contains cache size info", async () => {
    const tool = MemoryCacheStatus(dummyStore);
    const result = await (tool as any).execute({});
    expect(result).toMatch(/Current size: \d+ \/ \d+/);
  });

  test("reports TTL hours", async () => {
    const tool = MemoryCacheStatus(dummyStore);
    const result = await (tool as any).execute({});
    expect(result).toContain("TTL:");
    expect(result).toContain("hours");
  });
});
