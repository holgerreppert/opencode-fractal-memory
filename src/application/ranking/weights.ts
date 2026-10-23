import type { RankFeatures } from "./features";

/**
 * Feature weight resolution for the linear ranking model.
 *
 * score = Σ(w_i × feature_i)
 *
 * Defaults live here (single source of truth). All weights must be
 * non-negative; the pipeline normalizes the fused score to [0,1] afterwards.
 *
 * The `intent` weight is the P4 gate of the intent usefulness-vector plan:
 * 0 (default) keeps ranking behavior byte-identical to pre-vector; set
 * `ranking.featureWeights.intent` > 0 in config to activate the affinity
 * feature. Default weights sum to exactly 1.0 — raising `intent` above 0
 * raises the normalization max, re-balance the other weights accordingly.
 */
export type RankWeights = RankFeatures;

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  semantic: 0.45,
  bm25: 0.22,
  quality: 0.13,
  confidence: 0.05,
  usefulness: 0.05,
  cost: 0.1,
  intent: 0,
};
