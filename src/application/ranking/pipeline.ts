import type { MemoryNode, MemoryNodeLevel, SearchIntent } from "../../storage/types";
import { extractFeatures, type RankFeatures } from "./features";
import { fuseScore, normalizeFusedScore } from "./fusion";
import type { RankWeights } from "./weights";
import { DEFAULT_RANK_WEIGHTS } from "./weights";
import { computeIntentWeight } from "./intent";
import { computeRecencyScore } from "../../storage/queries/search-helpers";
import { cosineSimilarity } from "../../math";
import { memLog } from "../../logging";

export interface RankCandidate {
  node: MemoryNode;
  semanticScore: number;
  bm25Score?: number | undefined;
}

export interface RankOptions {
  weights?: RankWeights | undefined;
  /** RRF fusion constant k (1/(k+rank)). When set, candidates are fused by
   * reciprocal rank of semantic + BM25 scores instead of the feature-weighted
   * linear model. Default (unset) keeps the linear model. */
  rrfK?: number | undefined;
  levelWeights?: Partial<Record<MemoryNodeLevel, number>> | undefined;
  intent?: SearchIntent | undefined;
  recencyRole?: "tiebreak" | "off" | undefined;
  recencyAnchor?: (node: MemoryNode) => Date | null | undefined;
  /** MMR lambda in [0,1] — when set, results are re-ordered by MMR diversity: score = relevance - lambda * maxSimilarity */
  mmrLambda?: number | undefined;
  mmrMaxResults?: number | undefined;
}

export interface RankComponents {
  features: RankFeatures;
  weights: RankWeights;
  rawScore: number;
  intentWeight: number;
  levelWeight: number;
  contextual: number;
}

export interface RankedResult {
  node: MemoryNode;
  features: RankFeatures;
  rawScore: number;
  importance: number;
  components: RankComponents;
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
  if (options.rrfK !== undefined) {
    return rankByRRF(candidates, options);
  }

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
    const importance = normalizeFusedScore(contextual, weights);

    return {
      node,
      features,
      rawScore,
      importance,
      components: {
        features,
        weights,
        rawScore,
        intentWeight,
        levelWeight,
        contextual,
      },
    };
  });

  ranked.sort((a, b) => {
    const byImportance = b.importance - a.importance;
    if (byImportance !== 0) return byImportance;
    if (recencyRole === "off") return 0;
    return computeRecencyScore(recencyAnchor(b.node) ?? null) - computeRecencyScore(recencyAnchor(a.node) ?? null);
  });

  if (ranked.length > 0) {
    const top = ranked[0]!
    memLog("info", "ranking", "rankCandidates", {
      candidates: candidates.length,
      topId: top.node.id,
      topImportance: top.importance,
      topFeatures: top.features,
      intent: options.intent ?? null,
    })
  }

  if (options.mmrLambda !== undefined && ranked.length > 1) {
    const maxResults = options.mmrMaxResults ?? ranked.length
    return selectWithMMR(ranked, maxResults, options.mmrLambda)
  }

  return ranked;
}

export function toRankedNodes(ranked: RankedResult[]): MemoryNode[] {
  return ranked.map(r => ({ ...r.node, importance: r.importance }));
}

/**
 * RRF (Reciprocal Rank Fusion) fallback for the linear model. 1/(k+rank)
 * per signal (semantic, BM25), summed, min-max normalized to [0,1] with a
 * recency multiplier — mirrors the pre-linear-model computeRRFScores behavior.
 * Only used when the caller explicitly sets `rrfK` (1/(k+rank) with k ≥ 1).
 */
function rankByRRF(candidates: RankCandidate[], options: RankOptions): RankedResult[] {
  const k = Math.max(1, options.rrfK ?? 60);
  const featuresByNode = new Map<string, RankFeatures>();

  // Rank by semantic score desc (default 0 for BM25-only candidates)
  const bySemantic = candidates
    .slice()
    .sort((a, b) => (b.semanticScore ?? 0) - (a.semanticScore ?? 0));
  const semanticRank = new Map<string, number>();
  bySemantic.forEach((c, i) => semanticRank.set(c.node.id, i + 1));

  // Rank by BM25 score desc (only candidates that have one)
  const withBm25 = candidates
    .filter(c => c.bm25Score !== undefined && (c.bm25Score ?? 0) > 0)
    .sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0));
  const bm25Rank = new Map<string, number>();
  withBm25.forEach((c, i) => bm25Rank.set(c.node.id, i + 1));

  const rrfScores: Array<{ candidate: RankCandidate; rrfScore: number }> = [];
  for (const c of bySemantic) {
    const rankSem = semanticRank.get(c.node.id)!;
    const rankBm25 = bm25Rank.get(c.node.id);
    let rrfScore = 1 / (k + rankSem);
    if (rankBm25 !== undefined) {
      rrfScore += 1 / (k + rankBm25);
    }
    rrfScores.push({ candidate: c, rrfScore });
  }

  const rawScores = rrfScores.map(s => s.rrfScore);
  const minScore = Math.min(...rawScores);
  const maxScore = Math.max(...rawScores);
  const range = maxScore - minScore;

  const recencyRole = options.recencyRole ?? "tiebreak";
  const recencyAnchor = options.recencyAnchor ?? ((node: MemoryNode): Date | null =>
    (node.level ?? 0) >= 1 ? node.createdAt : node.lastAccessed);

  const weights = DEFAULT_RANK_WEIGHTS;
  const results: RankedResult[] = rrfScores.map(({ candidate, rrfScore }) => {
    const normalized = range > 0 ? (rrfScore - minScore) / range : 1.0;
    const recencyScore = recencyRole === "off" ? 1.0 : computeRecencyScore(recencyAnchor(candidate.node) ?? null);
    let features = featuresByNode.get(candidate.node.id);
    if (!features) {
      features = extractFeatures(candidate.node, { semanticScore: candidate.semanticScore, bm25Score: candidate.bm25Score });
      featuresByNode.set(candidate.node.id, features);
    }
    const importance = normalized * (0.3 + 0.7 * recencyScore);
    const rawScore = rrfScore;
    return {
      node: candidate.node,
      features,
      rawScore,
      importance,
      components: {
        features,
        weights,
        rawScore,
        intentWeight: 1,
        levelWeight: 1,
        contextual: rrfScore,
      },
    };
  });

  results.sort((a, b) => b.importance - a.importance);
  if (options.mmrLambda !== undefined && results.length > 1) {
    const maxResults = options.mmrMaxResults ?? results.length
    return selectWithMMR(results, maxResults, options.mmrLambda)
  }
  return results;
}

function embeddingSimilarity(a: MemoryNode, b: MemoryNode): number {
  const ea = (a as unknown as { embedding?: number[] }).embedding
  const eb = (b as unknown as { embedding?: number[] }).embedding
  if (ea && eb && ea.length > 0 && eb.length === ea.length) {
    try {
      return Math.max(0, cosineSimilarity(ea, eb))
    } catch { /* ignore */ }
  }
  // Fallback: same projectName penalty
  if (a.projectName && b.projectName && a.projectName === b.projectName) return 0.5
  if (a.type && b.type && a.type === b.type && a.label === b.label) return 0.9
  return 0
}

export function selectWithMMR(ranked: RankedResult[], maxResults: number, lambda: number): RankedResult[] {
  const lam = Math.min(1, Math.max(0, lambda))
  if (lam === 0 || ranked.length <= 1 || maxResults >= ranked.length) {
    if (maxResults < ranked.length) return ranked.slice(0, maxResults)
    return ranked
  }
  const selected: RankedResult[] = []
  const remaining = [...ranked]
  // seed with most relevant
  selected.push(remaining.shift()!)
  while (selected.length < maxResults && remaining.length > 0) {
    let bestIdx = -1
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!
      const relevance = cand.importance
      let maxSim = 0
      for (const s of selected) {
        const sim = embeddingSimilarity(cand.node, s.node)
        if (sim > maxSim) maxSim = sim
      }
      // session/project diversity: penalize if already >1 from same project
      const sameProjectCount = selected.filter(s => s.node.projectName && cand.node.projectName && s.node.projectName === cand.node.projectName).length
      if (sameProjectCount >= 2) maxSim = Math.max(maxSim, 0.7)
      const mmrScore = relevance - lam * maxSim
      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIdx = i
      }
    }
    if (bestIdx >= 0) selected.push(remaining.splice(bestIdx, 1)[0]!)
    else break
  }
  memLog("info", "ranking", "MMR selection", { lambda: lam, before: ranked.length, after: selected.length })
  return selected
}
