import { describe, expect, test } from "bun:test";
import { predictiveRateToolCall, applyScoreDecay } from "./predictive-rating";
import type { MemoryStore } from "../storage/sqlite";

interface MockNode {
  id: string;
  label?: string;
  usefulnessScore: number;
  timesUsed: number;
  timesHelpful: number;
  accessCount: number;
  scope: string;
}

function makeMockStore(initialNodes: MockNode[] = []) {
  const nodes = [...initialNodes];
  const updateLog: Array<{ id: string; updates: Record<string, unknown> }> = [];

  const store = {
    getNode: async (id: string) => {
      const n = nodes.find(x => x.id === id);
      if (!n) throw new Error("not found");
      return {
        id: n.id,
        scope: n.scope,
        label: n.label,
        usefulnessScore: n.usefulnessScore,
        timesHelpful: n.timesHelpful,
        timesUsed: n.timesUsed,
        accessCount: n.accessCount,
      };
    },
    getNodeByLabel: async (scope: string, label: string) => {
      const n = nodes.find(x => x.scope === scope && x.label === label);
      if (!n) throw new Error("not found");
      return {
        id: n.id,
        scope: n.scope,
        label: n.label,
        usefulnessScore: n.usefulnessScore,
        timesHelpful: n.timesHelpful,
        timesUsed: n.timesUsed,
        accessCount: n.accessCount,
      };
    },
    updateNode: async (id: string, updates: Record<string, unknown>) => {
      updateLog.push({ id, updates });
      const n = nodes.find(x => x.id === id);
      if (n) {
        if (typeof updates.usefulnessScore === "number") n.usefulnessScore = updates.usefulnessScore;
        if (typeof updates.timesHelpful === "number") n.timesHelpful = updates.timesHelpful;
      }
    },
    runScoreDecay: async () => 5,
  };

  return { store: store as unknown as MemoryStore, updateLog, nodes };
}

describe("predictiveRateToolCall", () => {
  test("memory_rate + helpful:true boosts score and increments helpful count", async () => {
    const { store, nodes } = makeMockStore([
      { id: "n1", label: "test-node", usefulnessScore: 1, timesUsed: 0, timesHelpful: 0, accessCount: 0, scope: "project" },
    ]);

    await predictiveRateToolCall(
      store,
      { tool: "memory_rate", args: { label: "test-node", helpful: true }, sessionID: "s1" },
      { metadata: {} },
      { decayDays: 30, positiveBoost: 1, negativePenalty: 0.5 }
    );

    expect(nodes[0]!.usefulnessScore).toBe(2);
    expect(nodes[0]!.timesHelpful).toBe(1);
  });

  test("memory_rate + helpful:false penalizes score", async () => {
    const { store, nodes } = makeMockStore([
      { id: "n1", label: "test-node", usefulnessScore: 2, timesUsed: 0, timesHelpful: 0, accessCount: 0, scope: "project" },
    ]);

    await predictiveRateToolCall(
      store,
      { tool: "memory_rate", args: { label: "test-node", helpful: false }, sessionID: "s1" },
      { metadata: {} },
      { decayDays: 30, positiveBoost: 1, negativePenalty: 0.5 }
    );

    expect(nodes[0]!.usefulnessScore).toBe(1.5);
  });

  test("memory_get success auto-boosts score", async () => {
    const { store, nodes } = makeMockStore([
      { id: "n1", label: "test-node", usefulnessScore: 0, timesUsed: 0, timesHelpful: 0, accessCount: 0, scope: "project" },
    ]);

    await predictiveRateToolCall(
      store,
      { tool: "memory_get", args: { id: "n1" }, sessionID: "s1" },
      { metadata: {} },
      { decayDays: 30, positiveBoost: 0.5, negativePenalty: 0.5 }
    );

    expect(nodes[0]!.usefulnessScore).toBe(0.5);
  });

  test("memory_get failure auto-penalizes score", async () => {
    const { store, nodes } = makeMockStore([
      { id: "n1", label: "test-node", usefulnessScore: 1, timesUsed: 0, timesHelpful: 0, accessCount: 0, scope: "project" },
    ]);

    await predictiveRateToolCall(
      store,
      { tool: "memory_get", args: { id: "n1" }, sessionID: "s1" },
      { metadata: { error: "something failed" } },
      { decayDays: 30, positiveBoost: 0.5, negativePenalty: 0.5 }
    );

    expect(nodes[0]!.usefulnessScore).toBe(0.5);
  });

  test("unrelated tool is no-op (does not throw)", async () => {
    const { store, nodes } = makeMockStore([
      { id: "n1", label: "test-node", usefulnessScore: 1, timesUsed: 0, timesHelpful: 0, accessCount: 0, scope: "project" },
    ]);

    await predictiveRateToolCall(
      store,
      { tool: "memory_list", args: {}, sessionID: "s1" },
      { metadata: {} },
      { decayDays: 30, positiveBoost: 1, negativePenalty: 0.5 }
    );

    expect(nodes[0]!.usefulnessScore).toBe(1);
  });

  test("caps score at 5 maximum", async () => {
    const { store, nodes } = makeMockStore([
      { id: "n1", label: "test-node", usefulnessScore: 4.5, timesUsed: 0, timesHelpful: 0, accessCount: 0, scope: "project" },
    ]);

    await predictiveRateToolCall(
      store,
      { tool: "memory_rate", args: { label: "test-node", helpful: true }, sessionID: "s1" },
      { metadata: {} },
      { decayDays: 30, positiveBoost: 1, negativePenalty: 0.5 }
    );

    expect(nodes[0]!.usefulnessScore).toBe(5);
  });
});

describe("applyScoreDecay", () => {
  test("calls runScoreDecay and returns message", async () => {
    const { store } = makeMockStore();
    const result = await applyScoreDecay(store, { decayDays: 30, positiveBoost: 1, negativePenalty: 0.5 });
    expect(result).toContain("decayed 5 nodes");
  });
});
