import type { RankFeatures } from "./features";
import { FEATURE_KEYS } from "./features";
import type { MemConfig } from "../../infrastructure/config/config";

/**
 * Feature weight resolution for the linear ranking model.
 *
 * score = Σ(w_i × feature_i)
 *
 * Defaults live here (single source of truth) and are overridden by the
 * config `ranking.featureWeights` section. All weights must be non-negative;
 * the pipeline normalizes the fused score to [0,1] afterwards.
 */
export type RankWeights = RankFeatures;

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  semantic: 0.5,
  bm25: 0.25,
  quality: 0.15,
  confidence: 0.05,
  usefulness: 0.05,
};

export function resolveRankWeights(config?: MemConfig): RankWeights {
  const fromConfig = config?.ranking?.featureWeights;
  if (!fromConfig) return { ...DEFAULT_RANK_WEIGHTS };

  const resolved: RankWeights = { ...DEFAULT_RANK_WEIGHTS };
  for (const key of FEATURE_KEYS) {
    const v = fromConfig[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      resolved[key] = v;
    }
  }
  return resolved;
}
