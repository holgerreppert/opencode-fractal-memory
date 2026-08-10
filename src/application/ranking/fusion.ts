import type { RankFeatures } from "./features";
import type { RankWeights } from "./weights";

/**
 * Linear fusion: score = Σ(w_i × feature_i). The result is a raw weighted sum
 * (not min-max normalized per query), so scores are calibrated absolute
 * values — gates and thresholds (injection minScore, gate delta) become
 * meaningful across queries instead of every top hit being ~1.0.
 */
export function fuseScore(features: RankFeatures, weights: RankWeights): number {
  return (
    features.semantic * weights.semantic +
    features.bm25 * weights.bm25 +
    features.quality * weights.quality +
    features.confidence * weights.confidence +
    features.usefulness * weights.usefulness
  );
}

/**
 * Normalize a fused score to [0,1] using the theoretical max achievable with
 * the given weights (all features at 1.0). Keeps absolute calibration while
 * bounding the range for downstream consumers that expect [0,1].
 */
export function normalizeFusedScore(raw: number, weights: RankWeights): number {
  const maxScore =
    weights.semantic + weights.bm25 + weights.quality + weights.confidence + weights.usefulness;
  if (maxScore <= 0) return 0;
  return Math.min(1, Math.max(0, raw / maxScore));
}
