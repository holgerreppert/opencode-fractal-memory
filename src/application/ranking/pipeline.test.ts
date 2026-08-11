import { describe, expect, test } from "bun:test";
import { rankCandidates, type RankCandidate } from "./pipeline";

function node(id: string, importance: number, createdAt = new Date(0)) {
  return {
    id,
    label: `n${id}`,
    content: "test",
    scope: "global",
    importance,
    createdAt,
  } as import("../../storage/types").MemoryNode;
}

describe("rankCandidates RRF fusion", () => {
  const mk = (sem: number, bm25?: number, id = String(sem)): RankCandidate => ({
    node: node(id, sem),
    semanticScore: sem,
    bm25Score: bm25,
  });

  test("with rrfK set, candidate in BOTH lists outranks same-semantic-rank single-list candidate", () => {
    const candidates: RankCandidate[] = [
      mk(0.9, 0.9, "both"),
      mk(0.8, undefined, "sem"),
    ];
    const rrf = rankCandidates(candidates, { rrfK: 60, recencyRole: "off" });
    expect(rrf[0]!.node.id).toBe("both");
    expect(rrf[0]!.importance).toBeGreaterThan(rrf[1]!.importance);
  });

  test("bm25-only candidate (semanticScore 0) still surfaces when rrfK set", () => {
    const candidates: RankCandidate[] = [
      mk(0.9, undefined, "sem"),
      mk(0.0, 1.0, "kw"),   // strong keyword hit, no semantic overlap
    ];
    const rrf = rankCandidates(candidates, { rrfK: 60, recencyRole: "off" });
    expect(rrf.map(r => r.node.id)).toContain("kw");
    expect(rrf.find(r => r.node.id === "kw")!.importance).toBeGreaterThan(0);
  });

  test("larger rrfK compresses the normalized score gap", () => {
    const candidates: RankCandidate[] = [
      mk(0.9, 0.9, "a"),   // rank 1 in both lists
      mk(0.8, 0.3, "b"),   // rank 2 sem, rank 3 bm25
      mk(0.7, undefined, "c"), // rank 3 sem only
    ];
    const k1 = rankCandidates(candidates, { rrfK: 1, recencyRole: "off" });
    const k100 = rankCandidates(candidates, { rrfK: 100, recencyRole: "off" });
    const gap1 = k1[0]!.importance - k1[1]!.importance;
    const gap100 = k100[0]!.importance - k100[1]!.importance;
    expect(k1[0]!.node.id).toBe("a");
    expect(k100[0]!.node.id).toBe("a");
    expect(gap1).toBeGreaterThan(gap100);
  });

  test("rrfK ≤ 0 is clamped to k=1", () => {
    const candidates: RankCandidate[] = [mk(0.9, undefined, "a"), mk(0.1, undefined, "b")];
    const clamped = rankCandidates(candidates, { rrfK: 0, recencyRole: "off" });
    const k1 = rankCandidates(candidates, { rrfK: 1, recencyRole: "off" });
    expect(clamped.map(r => r.importance)).toEqual(k1.map(r => r.importance));
  });
});
