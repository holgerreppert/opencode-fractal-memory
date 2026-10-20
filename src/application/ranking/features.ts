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
  cost: number;
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

/**
 * Adaptive quality multiplier (Dream-RSI Phase 1): amplifies nodes whose
 * stored importance and observed usefulness signal curation value, damps
 * well-trodden nodes via an access-count decay (anti-popularity runaway).
 * The stored-importance base is normalized around the 0.5 default so a
 * default node maps to exactly 1.0 — the linear model uses absolute
 * normalization, so the mean must stay put or the calibrated quality weight
 * (0.15) shifts for every query. Bounded to [0.4, 1.5] to prevent runaway.
 */
export function adaptiveQualityMultiplier(node: MemoryNode): number {
  const base = clamp01(node.importance ?? 0.5) / 0.5;
  const usefulness = node.usefulnessScore ?? 0;
  const accessCount = node.accessCount ?? 0;
  const adaptive = (base * (1 + usefulness / 5)) / (1 + accessCount / 5);
  return Math.min(1.5, Math.max(0.4, adaptive));
}

export function extractFeatures(node: MemoryNode, input: FeatureInput): RankFeatures {
  const totalCost = (node.metadata as Record<string, unknown> | null)?.totalCalls as number
    ?? (node.metadata as Record<string, unknown> | null)?.editCount as number
    ?? 5;
  return {
    semantic: clamp01(input.semanticScore),
    bm25: clamp01(input.bm25Score ?? 0),
    quality: clamp01(qualityFeature(node) * adaptiveQualityMultiplier(node)),
    confidence: clamp01(node.confidence ?? 0.5),
    usefulness: clamp01((node.usefulnessScore ?? 0) / 5),
    cost: clamp01(1 - Math.min(totalCost / 30, 1)),
  };
}

export const FEATURE_KEYS: Array<keyof RankFeatures> = [
  "semantic",
  "bm25",
  "quality",
  "confidence",
  "usefulness",
  "cost",
];
