import { describe, expect, test } from "bun:test";
import type { MemoryNode } from "../../storage/types";
import { adaptiveQualityMultiplier, extractFeatures } from "./features";
import { rankCandidates, type RankCandidate } from "./pipeline";

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

describe("adaptiveQualityMultiplier", () => {
  test("default node maps to exactly 1.0 (calibration preserved)", () => {
    expect(adaptiveQualityMultiplier(node({}))).toBe(1);
  });

  test("usefulness amplifies the multiplier up to the 1.5 cap", () => {
    expect(adaptiveQualityMultiplier(node({ usefulnessScore: 1 }))).toBeCloseTo(1.2, 5);
    expect(adaptiveQualityMultiplier(node({ usefulnessScore: 5 }))).toBe(1.5);
  });

  test("high access count damps the multiplier", () => {
    const fresh = adaptiveQualityMultiplier(node({}));
    const trodden = adaptiveQualityMultiplier(node({ accessCount: 4 }));
    expect(trodden).toBeLessThan(fresh);
    expect(trodden).toBeCloseTo(1 / 1.8, 5);
  });

  test("stored importance scales around the 0.5 default", () => {
    expect(adaptiveQualityMultiplier(node({ importance: 0.75 }))).toBeCloseTo(1.5, 5);
    expect(adaptiveQualityMultiplier(node({ importance: 0.25 }))).toBeCloseTo(0.5, 5);
  });

  test("multiplier is bounded to [0.4, 1.5]", () => {
    expect(adaptiveQualityMultiplier(node({ importance: 0.1, accessCount: 100 }))).toBe(0.4);
    expect(adaptiveQualityMultiplier(node({ importance: 1, usefulnessScore: 5 }))).toBe(1.5);
  });
});

describe("extractFeatures adaptive quality", () => {
  test("quality feature stays within [0,1] after adaptive scaling", () => {
    const features = extractFeatures(
      node({ usefulnessScore: 5, importance: 1 }),
      { semanticScore: 0.9 },
    );
    expect(features.quality).toBeGreaterThanOrEqual(0);
    expect(features.quality).toBeLessThanOrEqual(1);
  });

  test("useful node outranks identical stale node on quality", () => {
    const useful = extractFeatures(node({ usefulnessScore: 4 }), { semanticScore: 0.5 });
    const stale = extractFeatures(node({ accessCount: 10 }), { semanticScore: 0.5 });
    expect(useful.quality).toBeGreaterThan(stale.quality);
  });

  test("default node quality equals the plain label quality feature (no drift)", () => {
    const features = extractFeatures(node({}), { semanticScore: 0.5 });
    expect(features.quality).toBe(1);
  });

  test("rankCandidates orders an adaptive-useful node above a stale one", () => {
    const candidates: RankCandidate[] = [
      { node: node({ id: "useful", usefulnessScore: 4 }), semanticScore: 0.7 },
      { node: node({ id: "stale", accessCount: 10 }), semanticScore: 0.7 },
    ];
    const ranked = rankCandidates(candidates, { recencyRole: "off" });
    expect(ranked[0]!.node.id).toBe("useful");
  });
});
