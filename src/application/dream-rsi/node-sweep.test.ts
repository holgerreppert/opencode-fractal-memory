import { describe, expect, test } from "bun:test";
import { sweepNodeRatings } from "./node-sweep";
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
    embedding: null,
    embeddingSegments: null,
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
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

function makeStore(nodes: MemoryNode[]): Partial<MemoryStore> {
  const updated = new Map<string, number>();
  const deleted: string[] = [];

  return {
    listNodes: async () => nodes,
    updateNode: async (id: string, updates) => {
      if (updates.importance !== undefined) updated.set(id, updates.importance);
    },
    deleteNode: async (id: string) => { deleted.push(id); },
    get _updated() { return updated; },
    get _deleted() { return deleted; },
  };
}

describe("sweepNodeRatings", () => {
  test("promotes nodes with high helpful/useful ratio", async () => {
    const node = makeNode({ id: "n1", timesUsed: 15, timesHelpful: 13, importance: 0.5 });
    const store = makeStore([node]) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.promoted).toBe(1);
    expect(result.demoted).toBe(0);
  });

  test("demotes nodes with low helpful/useful ratio", async () => {
    const node = makeNode({ id: "n2", timesUsed: 25, timesHelpful: 1, importance: 0.8 });
    const store = makeStore([node]) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.demoted).toBe(1);
    expect(result.promoted).toBe(0);
  });

  test("deletes stale unused non-protected nodes older than 30 days", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const node = makeNode({ id: "n3", accessCount: 0, createdAt: oldDate });
    const store = makeStore([node]) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.superseded).toBe(1);
  });

  test("does not delete protected types (rule, lesson, dot, dream-rsi)", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const nodes = [
      makeNode({ id: "r1", accessCount: 0, createdAt: oldDate, label: "rule:mandatory:memory", type: "lesson" }),
      makeNode({ id: "d1", accessCount: 0, createdAt: oldDate, label: "dot:arch", type: "dot" }),
      makeNode({ id: "w1", accessCount: 0, createdAt: oldDate, label: "dream-rsi:active-strategy", type: "fact" }),
    ];
    const store = makeStore(nodes) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.superseded).toBe(0);
  });

  test("does not promote nodes with insufficient usage", async () => {
    const node = makeNode({ id: "n5", timesUsed: 8, timesHelpful: 8, importance: 0.5 });
    const store = makeStore([node]) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.promoted).toBe(0);
  });

  test("does not demote nodes with insufficient usage", async () => {
    const node = makeNode({ id: "n6", timesUsed: 15, timesHelpful: 0, importance: 0.8 });
    const store = makeStore([node]) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.demoted).toBe(0);
  });

  test("caps promoted importance at 1.0", async () => {
    const node = makeNode({ id: "n7", timesUsed: 15, timesHelpful: 15, importance: 0.95 });
    const store = makeStore([node]) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.promoted).toBe(1);
  });

  test("floors demoted importance at 0.1", async () => {
    const node = makeNode({ id: "n8", timesUsed: 25, timesHelpful: 0, importance: 0.12 });
    const store = makeStore([node]) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.demoted).toBe(1);
  });

  test("caps superseded at 20 per sweep", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const nodes = Array.from({ length: 30 }, (_, i) =>
      makeNode({ id: `s${i}`, accessCount: 0, createdAt: oldDate }),
    );
    const store = makeStore(nodes) as unknown as MemoryStore;
    const result = await sweepNodeRatings(store);
    expect(result.superseded).toBe(20);
  });
});
