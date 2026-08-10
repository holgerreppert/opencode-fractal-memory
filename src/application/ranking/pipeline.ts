import type { MemoryNode, MemoryNodeLevel, SearchIntent } from "../../storage/types";
import { extractFeatures, type RankFeatures } from "./features";
import { fuseScore, normalizeFusedScore } from "./fusion";
import type { RankWeights } from "./weights";
import { DEFAULT_RANK_WEIGHTS } from "./weights";
import { computeIntentWeight } from "./intent";
import { computeRecencyScore } from "../../storage/queries/search-helpers";

export interface RankCandidate {
  node: MemoryNode;
  semanticScore: number;
  bm25Score?: number | undefined;
}

export interface RankOptions {
  weights?: RankWeights | undefined;
  levelWeights?: Partial<Record<MemoryNodeLevel, number>> | undefined;
  intent?: SearchIntent | undefined;
  recencyRole?: "tiebreak" | "off" | undefined;
  recencyAnchor?: (node: MemoryNode) => Date | null | undefined;
}

export interface RankedResult {
  node: MemoryNode;
  features: RankFeatures;
  rawScore: number;
  importance: number;
}

/**
 * The ONE scoring pipeline. Retrieval (HNSW/BM25 candidate assembly) happens
 * upstream; this consumes raw semantic + bm25 scores and produces a calibrated
 * [0,1] importance for each candidate:
 *
 *   1. extract normalized features (semantic, bm25, quality, confidence, usefulness)
 *   2. linear fusion: rawScore = Σ(w_i × feature_i)
 *   3. explicit contextual multipliers: intent weight, level weight
 *   4. normalize to [0,1] against the weight max (absolute, not per-query min-max)
 *   5. sort by importance desc; recency only breaks ties (default role)
 *
 * Recency is NOT a multiplicative penalty: a hard decay silently suppresses
 * all durable knowledge injection (the old 0.3 floor bug). It acts only as a
 * tiebreaker, anchored from createdAt for level ≥ 1 nodes (search no longer
 * re-stamps last_accessed, so summaries can't self-renew recency forever).
 */
export function rankCandidates(candidates: RankCandidate[], options: RankOptions = {}): RankedResult[] {
  const weights = options.weights ?? DEFAULT_RANK_WEIGHTS;
  const levelWeights = options.levelWeights ?? {};
  const recencyRole = options.recencyRole ?? "tiebreak";
  const recencyAnchor = options.recencyAnchor ?? ((node: MemoryNode): Date | null =>
    (node.level ?? 0) >= 1 ? node.createdAt : node.lastAccessed);

  const ranked: RankedResult[] = candidates.map(({ node, semanticScore, bm25Score }) => {
    const features = extractFeatures(node, { semanticScore, bm25Score });
    const rawScore = fuseScore(features, weights);

    const intentWeight = computeIntentWeight(options.intent, node.category, node.type, node.supertype);
    const levelWeight = levelWeights[(node.level ?? 0) as MemoryNodeLevel] ?? 1;
    const contextual = rawScore * intentWeight * levelWeight;

    return {
      node,
      features,
      rawScore,
      importance: normalizeFusedScore(contextual, weights),
    };
  });

  ranked.sort((a, b) => {
    const byImportance = b.importance - a.importance;
    if (byImportance !== 0) return byImportance;
    if (recencyRole === "off") return 0;
    return computeRecencyScore(recencyAnchor(b.node) ?? null) - computeRecencyScore(recencyAnchor(a.node) ?? null);
  });

  return ranked;
}

export function toRankedNodes(ranked: RankedResult[]): MemoryNode[] {
  return ranked.map(r => ({ ...r.node, importance: r.importance }));
}
