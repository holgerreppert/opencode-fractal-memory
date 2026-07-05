import { MemoryInject } from "./inject";
import type { MemoryStore, MemoryNode } from "../storage/sqlite";
import { describe, it, expect } from "@jest/globals";

const mockStore = {
  async searchByEmbedding(_embedding: number[], limit?: number, _options?: Record<string, unknown>): Promise<MemoryNode[]> {
    const nodes: MemoryNode[] = [];
    for (let i = 1; i <= 5; i++) {
      nodes.push({
        id: `node${i}`,
        scope: "project",
        label: `Node ${i}`,
        content: `Content ${i}`,
        summary: null,
        level: 0,
        parentIds: null,
        embedding: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        importance: 1,
        accessCount: 0,
        lastAccessed: null,
        type: null,
        metadata: { tokenCount: i * 100 },
        sticky: false,
        confidence: 0,
        lastVerified: null,
        usefulnessScore: 0,
        timesUsed: 0,
        timesHelpful: 0,
      });
    }
    return nodes;
  },
  async ensureSeed() { /* empty */ },
  async listNodes() { return []; },
  async getNode() { throw new Error("not used"); },
  async getNodeByPrefix() { throw new Error("not used"); },
  async getNodeByLabel() { throw new Error("not used"); },
  async createNode() { throw new Error("not used"); },
  async updateNode() { /* empty */ },
  async deleteNode() { /* empty */ },
  async runCompression() { return { compressed: 0, created: 0 }; },
  async runPatternExtraction() { return { created: 0, sources: 0 }; },
  async getCompressionCandidates() { return []; },
  async getFractalStats() { return { totalNodes: 0, nodesPerLevel: {0:0,1:0,2:0,3:0,4:0,5:0}, compressionRatios: {}, fractalDimension: 0, avgChildrenPerNode: 0, treeDepth: 0, hasEmbeddings: 0, scopes: {global:0, project:0} }; },
  async retrieveFractal() { return { node: null, path: [], depth: 0, relevanceScore: 0 }; },
  async detectTopicBoundaries() { return []; },
  async drilldownQuery() { return []; },
  async verifyNode() { return null; },
  async calculateNodeConfidence() { return 0; },
  async getConfig() { return ""; },
  async setConfig() { /* empty */ },
  async logToolCall() { /* empty */ },
  async getToolPatterns() { return []; },
  async getFrequentSequences() { return []; },
  async pruneUsageLog() { return 0; },
  async runScoreDecay() { return 0; },
  async pruneNodes() { return { prunable: [], pruned: 0 }; },
  async storeLinks() { /* empty */ },
  async getLinkedNodes() { return []; },
  async backfillLinks() { /* empty */ },
  async updateLinksForNewNode() { /* empty */ },
  async createTemporalEdge() { return { id: "", sourceNodeId: "", targetNodeId: "", edgeType: "", scope: "project", createdAt: 0, confidence: 1, metadata: null }; },
  async getTemporalEdges() { return []; },
  async expandWithTemporalContext() { return []; },
  async backfillBinaryEmbeddingsAndBM25() { /* empty */ },
  async rebuildHNSWIndex() { /* empty */ },
  async logInjectionMetrics() { /* empty */ },
  async recordMemoryToolCall() { /* empty */ },
  async finalizeInjection() { /* empty */ },
  async recordInjectionFeedback() { /* empty */ },
  async getInjectionMetrics() { return []; },
  async getSessionStats() { return null; },
  async recordAgentToolCall() { /* empty */ },
  async createSessionMetrics() { /* empty */ },
  async updateSessionMetrics() { /* empty */ },
  async incrementSessionToolCall() { /* empty */ },
  async getSessionMetrics() { return null; },
} as unknown as MemoryStore;

describe("MemoryInject greedy token‑budget selector", () => {
  it("respects maxTokens and prefers high relevance‑per‑token nodes", async () => {
    const tool = MemoryInject(mockStore);
    const result = await tool.execute({ query: "test", maxTokens: 350, includeConfidential: false });
    expect(result).toContain("Content 1");
    expect(result).toContain("Content 2");
    expect(result).not.toContain("Content 3");
    const tokenLine = result.split("\n").find((l: string) => l.startsWith("Token count:")) as string;
    const tokenCount = Number(tokenLine.split(":")[1].trim());
    expect(tokenCount).toBeLessThanOrEqual(350);
  });

  it("injects fallback when no nodes fit the token budget", async () => {
    const tool = MemoryInject(mockStore);
    const result = await tool.execute({
      query: "test query",
      maxTokens: 10,
      includeConfidential: false,
      costWeight: 0,
    });
    expect(result).toContain("fallback");
    expect(result).toContain("No relevant memories fit the token budget");
  });
});
