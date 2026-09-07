import { MemoryRate, MemoryGet } from "./core";
import type { MemoryStore } from "../storage/sqlite";
import { describe, it, expect } from "@jest/globals";

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "node-1",
    scope: "project",
    label: "test:node-1",
    content: "Test content.",
    summary: null,
    level: 0,
    parentIds: null,
    embedding: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    importance: 0.5,
    accessCount: 7,
    lastAccessed: null,
    type: "note",
    domain: null,
    metadata: null,
    sticky: false,
    confidence: 0,
    lastVerified: null,
    usefulnessScore: 1.2,
    timesUsed: 3,
    timesHelpful: 1,
    ...overrides,
  };
}

function makeStore(node: Record<string, unknown>, captured: Array<{ id: string; u: Record<string, unknown> }>) {
  return {
    async getNode() { return node; },
    async getNodeByLabel() { return node; },
    async updateNode(id: string, u: Record<string, unknown>) { captured.push({ id, u }); },
    async logToolCall() { /* empty */ },
  } as unknown as MemoryStore;
}

describe("MemoryRate downvote", () => {
  it("helpful=false decrements usefulness by 0.5", async () => {
    const captured: Array<{ id: string; u: Record<string, unknown> }> = [];
    const tool = MemoryRate(makeStore(makeNode(), captured));
    const result = await tool.execute({ label: "test:node-1", helpful: false });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.u.usefulnessScore).toBeCloseTo(0.7);
    expect(result).toContain("downvoted");
  });

  it("helpful=false floors at 0", async () => {
    const captured: Array<{ id: string; u: Record<string, unknown> }> = [];
    const tool = MemoryRate(makeStore(makeNode({ usefulnessScore: 0.2 }), captured));
    await tool.execute({ label: "test:node-1", helpful: false });
    expect(captured[0]!.u.usefulnessScore).toBe(0);
  });

  it("explicit usefulness_score wins over the vote", async () => {
    const captured: Array<{ id: string; u: Record<string, unknown> }> = [];
    const tool = MemoryRate(makeStore(makeNode(), captured));
    await tool.execute({ label: "test:node-1", helpful: false, usefulness_score: 4 });
    expect(captured[0]!.u.usefulnessScore).toBe(4);
  });

  it("helpful=true still increments timesHelpful", async () => {
    const captured: Array<{ id: string; u: Record<string, unknown> }> = [];
    const tool = MemoryRate(makeStore(makeNode(), captured));
    await tool.execute({ label: "test:node-1", helpful: true });
    expect(captured[0]!.u.timesHelpful).toBe(2);
    expect(captured[0]!.u.usefulnessScore).toBeUndefined();
  });
});

describe("MemoryGet score exposure", () => {
  it("includes usefulness, times used and times helpful", async () => {
    const tool = MemoryGet(makeStore(makeNode(), []) as unknown as MemoryStore);
    const result = await tool.execute({ label: "test:node-1" }) as unknown as string;
    expect(result).toContain("Usefulness: 1.2/5 (used 3×, helpful 1×)");
  });
});
