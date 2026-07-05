import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { type MemoryStore, type FractalRetrievalResult } from "./storage/types";
import { fileSummarization, type SummaryEvent } from "./application/file-summarization";

const tempDir = "/tmp/opencode-mem-test-file-summary";

function makeMockStore(): MemoryStore {
  const nodes: Map<string, Record<string, unknown>> = new Map();
  return {
    async createNode(input: Record<string, unknown>) {
      const id = `node_${Math.random().toString(36).slice(2)}`;
      const node = {
        ...input,
        id,
        scope: input.scope ?? "project",
        createdAt: new Date(),
        updatedAt: new Date(),
        accessCount: 0,
        embedding: null,
        importance: input.importance ?? 0,
        confidence: input.confidence ?? 0.5,
        usefulnessScore: 0,
        timesUsed: 0,
        timesHelpful: 0,
        lastAccessed: null,
        metadata: input.metadata ?? null,
        level: 0,
        summary: null,
        parentIds: null as string[] | null,
        type: "note",
        label: input.label ?? null,
        content: input.content ?? "",
        category: null,
        expiresAt: null,
        projectName: input.projectName ?? null,
        sticky: false,
        lastVerified: null,
      };
      nodes.set(id, node);
      return node;
    },
    async getNode(id: string) { return nodes.get(id) ?? null; },
    async getNodeByLabel(_scope: string, label: string) {
      for (const node of nodes.values()) {
        if (node.label === label) return node;
      }
      throw new Error("not found");
    },
    async updateNode(id: string, updates: Record<string, unknown>) {
      const node = nodes.get(id);
      if (!node) throw new Error("not found");
      Object.assign(node, updates);
      return node;
    },
    async listNodes(_scope: string, _filter?: unknown) { return Array.from(nodes.values()); },
    async searchByEmbedding(_query: number[], _limit?: number, _options?: Record<string, unknown>): Promise<FractalRetrievalResult[]> { return []; },
    async pruneNodes(_scope: string, _options: Record<string, unknown>) { return { prunable: [], pruned: 0 }; },
    async close() {},
    async runCompression(_opts?: Record<string, unknown>) { return { compressed: 0, created: 0 }; },
    logToolCall: async () => {},
    getToolPatterns: async () => [],
    pruneUsageLog: async () => 0,
    ensureSeed: async () => {},
    getConfig: async () => "",
    setConfig: async () => {},
    storeLinks: async () => {},
    getLinkedNodes: async () => [],
    backfillLinks: async () => {},
    updateLinksForNewNode: async () => {},
    createTemporalEdge: async () => ({ id: "", sourceNodeId: "", targetNodeId: "", edgeType: "", scope: "project" as const, createdAt: 0, confidence: 1, metadata: null }),
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
  };
}

describe("file-summarization", () => {
  beforeEach(() => {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (e) {
      // temp dir setup failed — tests will skip if dir is missing
    }
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // cleanup is best-effort
    }
  });

  it("should skip files under minLines", async () => {
    const store = makeMockStore();
    const filePath = path.join(tempDir, "small.txt");
    fs.writeFileSync(filePath, "hello\n".repeat(5));

    const events: SummaryEvent[] = [];
    await fileSummarization({
      store,
      filePath,
      projectDir: tempDir,
      minLines: 20,
      maxSizeBytes: 100000,
      onSummary: (e) => events.push(e),
    });

    expect(events.length).toBe(0);
  });

  it("should skip binary files", async () => {
    const store = makeMockStore();
    const filePath = path.join(tempDir, "binary.bin");
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02]));

    const events: SummaryEvent[] = [];
    await fileSummarization({
      store,
      filePath,
      projectDir: tempDir,
      minLines: 1,
      maxSizeBytes: 100000,
      onSummary: (e) => events.push(e),
    });

    expect(events.length).toBe(0);
  });

  it("should generate summary for text files", async () => {
    const store = makeMockStore();
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "line\n".repeat(250));

    const events: SummaryEvent[] = [];
    await fileSummarization({
      store,
      filePath,
      projectDir: tempDir,
      minLines: 1,
      maxSizeBytes: 100000,
      onSummary: (e) => events.push(e),
    });

    expect(events.length).toBeGreaterThan(0);
    const summary = events.find(e => e.type === "summary");
    expect(summary).toBeDefined();
  });
});
