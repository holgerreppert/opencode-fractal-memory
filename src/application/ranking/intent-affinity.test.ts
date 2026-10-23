import { describe, expect, test } from "bun:test";
import type { MemoryNode } from "../../storage/types";
import { computeIntentAffinity } from "./features";
import { rankCandidates, type RankCandidate } from "./pipeline";
import { DEFAULT_RANK_WEIGHTS } from "./weights";

function node(partial: Partial<MemoryNode>): MemoryNode {
  return {
    id: partial.id ?? "n1",
    label: partial.label ?? "lesson:test",
    content: "test",
    scope: "global",
    importance: 0.5,
    accessCount: 0,
    usefulnessScore: 0,
    createdAt: new Date(0),
    ...partial,
  } as MemoryNode;
}

function candidates(): RankCandidate[] {
  // Two identical candidates; only the intent vector differs.
  return [
    { node: node({ id: "debugged", metadata: { intentVector: { debug: 6, plan: 2 } } }), semanticScore: 0.5 },
    { node: node({ id: "planned", metadata: { intentVector: { debug: 2, plan: 6 } } }), semanticScore: 0.5 },
  ];
}

describe("computeIntentAffinity", () => {
  test("share-normalizes the vector on the declared intent", () => {
    const meta = { intentVector: { debug: 6, plan: 2 } };
    expect(computeIntentAffinity(meta, "debug")).toBeCloseTo(0.75, 5);
    expect(computeIntentAffinity(meta, "plan")).toBeCloseTo(0.25, 5);
  });

  test("neutral zero without a task intent or without a vector", () => {
    expect(computeIntentAffinity({ intentVector: { debug: 3 } }, undefined)).toBe(0);
    expect(computeIntentAffinity(null, "debug")).toBe(0);
    expect(computeIntentAffinity({ other: 1 }, "debug")).toBe(0);
  });
});

describe("rankCandidates with taskIntent", () => {
  test("default weight 0: ranking identical with or without taskIntent (P4 gate)", () => {
    const base = candidates();
    const gated = candidates();
    const without = rankCandidates(base, { recencyRole: "off" });
    const withIntent = rankCandidates(gated, { taskIntent: "debug", recencyRole: "off" });
    expect(withIntent[0]!.importance).toBeCloseTo(without[0]!.importance, 10);
    // Deterministic tie-break between equal importances — order preserved.
    expect(withIntent.map(r => r.node.id)).toEqual(without.map(r => r.node.id));
  });

  test("weight > 0 with taskIntent reorders toward the matching vector", () => {
    const weights = { ...DEFAULT_RANK_WEIGHTS, intent: 0.3 };
    const ranked = rankCandidates(candidates(), { weights, taskIntent: "debug", recencyRole: "off" });
    expect(ranked[0]!.node.id).toBe("debugged");
    expect(ranked[0]!.features.intent).toBeCloseTo(0.75, 5);

    const flipped = rankCandidates(candidates(), { weights, taskIntent: "plan", recencyRole: "off" });
    expect(flipped[0]!.node.id).toBe("planned");
  });

  test("weight > 0 but no declared intent keeps the base order", () => {
    const weights = { ...DEFAULT_RANK_WEIGHTS, intent: 0.3 };
    const ranked = rankCandidates(candidates(), { weights, recencyRole: "off" });
    // Equal features except the (unconsumed) intent dimension → tie.
    expect(ranked[0]!.importance).toBeCloseTo(ranked[1]!.importance, 10);
    expect(ranked.every(r => r.features.intent === 0)).toBe(true);
  });

  test("candidates without a vector are outranked under a matching intent", () => {
    const weights = { ...DEFAULT_RANK_WEIGHTS, intent: 0.3 };
    const mix: RankCandidate[] = [
      { node: node({ id: "veteran", metadata: { intentVector: { debug: 9 } } }), semanticScore: 0.5 },
      { node: node({ id: "virgin" }), semanticScore: 0.5 },
    ];
    const ranked = rankCandidates(mix, { weights, taskIntent: "debug", recencyRole: "off" });
    expect(ranked[0]!.node.id).toBe("veteran");
    expect(ranked[1]!.features.intent).toBe(0);
  });
});
