import { describe, expect, test, beforeAll } from "bun:test";
import { runConsolidation } from "./consolidation";
import type { MemoryStore, MemoryNode } from "../storage/sqlite";

function makeEmbedding(value: number): number[] {
  const emb = new Array(128).fill(0);
  emb[0] = value;
  return emb;
}

function makeMockStore(options: {
  episodicNodes?: number;
  extraNodes?: Array<Partial<MemoryNode>>;
  skipEmbedding?: boolean;
}) {
  const nodes: MemoryNode[] = [];
  const createdNodes: MemoryNode[] = [];

  for (let i = 0; i < (options.episodicNodes ?? 0); i++) {
    const embedding = options.skipEmbedding ? undefined : makeEmbedding(i % 3 === 0 ? 0.9 : 0.1);
    nodes.push({
      id: `episodic-${i}`,
      label: `episodic-node-${i}`,
      content: `This is episodic node ${i}. It describes how the function parseInput uses zod schema validation. The schema is defined with z.object and validates API request payloads.`,
      scope: "project" as const,
      level: 0 as const,
      type: "event" as const,
      category: "episodic" as const,
      importance: 0.5,
      embedding: embedding ?? null,
      parentIds: null,
      metadata: { sessionId: "test-session" },
      summary: `Episodic node ${i}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      version: 1,
      sticky: false,
      usefulnessScore: 0,
      timesHelpful: 0,
      timesUsed: 0,
      confidence: 0.5,
      drift: 0,
    } as MemoryNode);
  }

  for (const extra of options.extraNodes ?? []) {
    nodes.push({
      id: `extra-${Date.now()}-${Math.random()}`,
      label: "extra-node",
      content: "Some extra content",
      scope: "project" as const,
      level: 0 as const,
      type: "note" as const,
      category: "semantic" as const,
      importance: 0.5,
      embedding: null,
      parentIds: null,
      metadata: null,
      summary: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      version: 1,
      sticky: false,
      usefulnessScore: 0,
      timesHelpful: 0,
      timesUsed: 0,
      confidence: 0.5,
      drift: 0,
      ...extra,
    } as MemoryNode);
  }

  const store = {
    listNodes: async (_scope: string, _level?: number) => nodes,
    createNode: async (input: { label: string; content: string; type: string }) => {
      const newNode = {
        id: `fact-${createdNodes.length}`,
        ...input,
        scope: "project" as const,
        level: 0 as const,
        category: "semantic" as const,
        importance: 0.5,
        embedding: null,
        parentIds: null,
        metadata: null,
        summary: "",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessed: new Date(),
        accessCount: 0,
        version: 1,
        sticky: false,
        usefulnessScore: 0,
        timesHelpful: 0,
        timesUsed: 0,
        confidence: 0.5,
        drift: 0,
      } as MemoryNode;
      createdNodes.push(newNode);
      return newNode;
    },
  };

  return { store: store as unknown as MemoryStore, nodes, createdNodes };
}

describe("runConsolidation", () => {
  test("skips when disabled", async () => {
    const { store } = makeMockStore({ episodicNodes: 5 });
    const result = await runConsolidation(store, { enabled: false, similarityThreshold: 0.3, maxFactsPerCluster: 5, minClusterSize: 2 });
    expect(result).toContain("skipped");
  });

  test("skips when too few episodic nodes", async () => {
    const { store } = makeMockStore({ episodicNodes: 1 });
    const result = await runConsolidation(store, { enabled: true, similarityThreshold: 0.3, maxFactsPerCluster: 5, minClusterSize: 2 });
    expect(result).toContain("skipped");
    expect(result).toContain("only 1");
  });

  test("skips when no clusters found", async () => {
    const { store } = makeMockStore({ episodicNodes: 10, skipEmbedding: true });
    const result = await runConsolidation(store, { enabled: true, similarityThreshold: 0.3, maxFactsPerCluster: 5, minClusterSize: 2 });
    expect(result).toContain("no related clusters");
  });

  test("extracts facts from clustered episodic nodes", async () => {
    const { store, createdNodes } = makeMockStore({ episodicNodes: 6 });
    const result = await runConsolidation(store, { enabled: true, similarityThreshold: 0.3, maxFactsPerCluster: 5, minClusterSize: 2 });
    expect(createdNodes.length).toBeGreaterThan(0);
    expect(createdNodes.every(n => n.type === "fact")).toBe(true);
    expect(result).toContain("Consolidation:");
  });

  test("creates fact nodes with semantic declarations", async () => {
    const { store, createdNodes } = makeMockStore({ episodicNodes: 6 });
    await runConsolidation(store, { enabled: true, similarityThreshold: 0.3, maxFactsPerCluster: 5, minClusterSize: 2 });
    for (const fact of createdNodes) {
      expect(fact.content).toMatch(/(uses|validates|defined|is|has)/i);
    }
  });

  test("respects maxFactsPerCluster limit", async () => {
    const { store, createdNodes } = makeMockStore({ episodicNodes: 6 });
    await runConsolidation(store, { enabled: true, similarityThreshold: 0.3, maxFactsPerCluster: 1, minClusterSize: 2 });
    expect(createdNodes.length).toBeLessThanOrEqual(3);
  });

  test("does not consolidate semantic nodes even with many present", async () => {
    const { store, createdNodes } = makeMockStore({
      episodicNodes: 0,
      extraNodes: [
        { id: "semantic-1", label: "concept-node", content: "This is a concept about architecture patterns. The system uses layered architecture with service and repository layers.", type: "concept", category: "semantic", embedding: makeEmbedding(0.9) },
        { id: "semantic-2", label: "fact-node", content: "The system uses zod for validation. Schema validation happens at the controller layer.", type: "fact", category: "semantic", embedding: makeEmbedding(0.9) },
        { id: "semantic-3", label: "rule-node", content: "Always validate input before processing. Never trust client data.", type: "rule", category: "semantic", embedding: makeEmbedding(0.9) },
      ],
    });
    const result = await runConsolidation(store, { enabled: true, similarityThreshold: 0.3, maxFactsPerCluster: 5, minClusterSize: 2 });
    expect(createdNodes.length).toBe(0);
    expect(result).toContain("only 0 episodic nodes");
  });

  test("mixes episodic and semantic, only consolidates episodic", async () => {
    const { store, createdNodes } = makeMockStore({
      episodicNodes: 3,
      extraNodes: [
        { id: "semantic-1", label: "concept-node", content: "This is a concept about architecture patterns. The system uses layered architecture with service and repository layers.", type: "concept", category: "semantic", embedding: makeEmbedding(0.9) },
        { id: "semantic-2", label: "fact-node", content: "The system uses zod for validation. Schema validation happens at the controller layer.", type: "fact", category: "semantic", embedding: makeEmbedding(0.9) },
      ],
    });
    const result = await runConsolidation(store, { enabled: true, similarityThreshold: 0.3, maxFactsPerCluster: 5, minClusterSize: 2 });
    expect(createdNodes.length).toBeGreaterThan(0);
    for (const n of createdNodes) {
      expect(n.type).toBe("fact");
    }
    expect(result).toContain("Consolidation:");
  });
});
