import type { MemoryNode } from "../../storage/types";
import { computeQualityMultiplier } from "../../storage/queries/search-helpers";

/**
 * Normalized ranking features, all on [0,1]. The unified feature-weighted
 * linear model replaces the old multiplicative magic-number chain
 * (levelWeight * confidenceWeight * stratumWeight * (1 + usefulness*0.1))
 * scattered across searchByEmbedding. Each signal is a named, bounded
 * feature so weights are interpretable and tunable (LTR-ready).
 */
export interface RankFeatures {
  semantic: number;
  bm25: number;
  quality: number;
  confidence: number;
  usefulness: number;
}

export interface FeatureInput {
  semanticScore: number;
  bm25Score?: number | undefined;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Map the label/type quality multiplier into a [0,1] feature. The multiplier
 * lives on [0.5, 1.3] (storedcontext session dumps demoted, purpose-centric
 * labels boosted); rescale to a feature so it composes additively with the
 * other signals instead of multiplying the whole score.
 */
export function qualityFeature(node: MemoryNode): number {
  const multiplier = computeQualityMultiplier(node);
  return clamp01((multiplier - 0.5) / (1.3 - 0.5));
}

export function extractFeatures(node: MemoryNode, input: FeatureInput): RankFeatures {
  return {
    semantic: clamp01(input.semanticScore),
    bm25: clamp01(input.bm25Score ?? 0),
    quality: qualityFeature(node),
    confidence: clamp01(node.confidence ?? 0.5),
    usefulness: clamp01((node.usefulnessScore ?? 0) / 5),
  };
}

export const FEATURE_KEYS: Array<keyof RankFeatures> = [
  "semantic",
  "bm25",
  "quality",
  "confidence",
  "usefulness",
];
