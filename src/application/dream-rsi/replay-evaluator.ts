/**
 * Dream-RSI Replay Evaluator
 *
 * At session.idle, replays the session's memory queries with alternative
 * retrieval strategies (keyword, cross-encoder, different intents) and
 * scores each strategy against the actual outcomes (which injected nodes
 * were later rated useful). This is the core Dream-RSI insight: using
 * accumulated discovery history as a replay simulator to cheaply evaluate
 * alternative policies without re-running the real agent.
 *
 * Reference: Dream-RSI (arXiv 2609.14858) — Section 3
 */

import type { MemoryStore } from "../../storage/sqlite";
import { searchNodes } from "../search";
import { memLog } from "../../logging";

export interface ReplayStrategy {
  id: string;
  label: string;
  rerankMode?: "keyword" | "cross-encoder";
  intent?: "read" | "edit" | "debug" | "discovery";
  pipeline?: "hybrid" | "drilldown";
}

export interface ReplayQuery {
  queryText: string;
  originalStrategy: string;
  injectedNodeIds: string[];
  feedbackScore: number;
}

export interface StrategyScore {
  strategyId: string;
  strategyLabel: string;
  avgScore: number;
  qualityScore: number;
  costPenalty: number;
  parallelismBonus: number;
  queriesTested: number;
  totalOverlap: number;
  details: Array<{
    query: string;
    score: number;
    overlapCount: number;
    retrievedCount: number;
  }>;
}

export interface ReplayResult {
  bestStrategyId: string;
  strategies: StrategyScore[];
  queriesReplayed: number;
  sessionsReplayed: number;
  revision?: number;
  previousScore?: number;
}

export interface ReplayConfig {
  maxRevisions: number;
  costWeight: number;
  parallelismWeight: number;
}

const DEFAULT_STRATEGIES: ReplayStrategy[] = [
  { id: "drilldown", label: "drilldown baseline (injection pipeline)", pipeline: "drilldown" },
  { id: "keyword", label: "keyword rerank", rerankMode: "keyword" },
  { id: "cross-encoder", label: "cross-encoder rerank", rerankMode: "cross-encoder" },
  { id: "intent-debug", label: "cross-encoder + debug intent", rerankMode: "cross-encoder", intent: "debug" },
  { id: "intent-read", label: "cross-encoder + read intent", rerankMode: "cross-encoder", intent: "read" },
  { id: "intent-edit", label: "cross-encoder + edit intent", rerankMode: "cross-encoder", intent: "edit" },
];

const DEFAULT_REPLAY_CONFIG: ReplayConfig = {
  maxRevisions: 2,
  costWeight: 0.1,
  parallelismWeight: 0.05,
};

function estimateCostPenalty(strategy: ReplayStrategy, queryCount: number): number {
  if (!strategy.rerankMode || strategy.rerankMode === "keyword") return 0;
  return Math.min(queryCount / 50, 1.0);
}

function estimateParallelismBonus(strategy: ReplayStrategy): number {
  if (!strategy.intent) return 0;
  return 0.15;
}

function computeFeedbackScore(metric: {
  injectionUpvotes?: number;
  injectionDownvotes?: number;
  effectivenessScore?: number | null;
}): number {
  const upvotes = metric.injectionUpvotes ?? 0;
  const downvotes = metric.injectionDownvotes ?? 0;
  const effectiveness = metric.effectivenessScore ?? 0;
  return (upvotes - downvotes) * 0.5 + effectiveness * 0.5;
}

/**
 * A strategy PRODUCED a row when the row's originalStrategy matches its id
 * or its rerankMode family (cross-encoder rows also credit intent-* siblings).
 */
function producedByStrategy(strategy: ReplayStrategy, originalStrategy: string): boolean {
  return strategy.id === originalStrategy
    || (strategy.rerankMode !== undefined && strategy.rerankMode === originalStrategy);
}

/**
 * Feedback is only discriminating if it is attributed to the strategy that
 * PRODUCED the row: positive feedback lifts the producing pipeline to 1.0
 * (others cap at 0.8 via overlap), negative feedback caps the producer at
 * 0.6 so an overlapping challenger can dethrone it. Rows with no feedback
 * stay a pure overlap contest (0.2 floor for everyone).
 */
function feedbackTermFor(strategy: ReplayStrategy, query: ReplayQuery): number {
  const producer = producedByStrategy(strategy, query.originalStrategy);
  if (query.feedbackScore > 0) return producer ? 0.4 : 0.2;
  if (query.feedbackScore < 0) return producer ? 0.0 : 0.2;
  return 0.2;
}

/**
 * Gap C: Dynamic strategy set selection based on score history.
 * If converging, test fewer strategies (exploit). If diverging, test all (explore).
 */
export function selectStrategies(scoreHistory: number[]): ReplayStrategy[] {
  if (scoreHistory.length < 2) return [...DEFAULT_STRATEGIES];
  const max = Math.max(...scoreHistory);
  const min = Math.min(...scoreHistory);
  if (max - min > 0.3) return [...DEFAULT_STRATEGIES];
  if (max - min <= 0.1) return DEFAULT_STRATEGIES.filter(s => ["drilldown", "keyword", "cross-encoder", "intent-debug"].includes(s.id));
  return [...DEFAULT_STRATEGIES];
}

/**
 * Gap B: Beta adaptation across recursive rounds.
 * If scores improving, keep β. If plateaued, increase costWeight. If declining, decrease.
 */
export async function adaptBeta(store: MemoryStore, currentConfig: ReplayConfig): Promise<{ config: ReplayConfig; adaptation?: BetaAdaptation }> {
  try {
    const node = await store.getNodeByLabel("project", "dream-rsi:active-strategy");
    const meta = (node.metadata as Record<string, unknown> | null) ?? {};
    const history = (meta.scoreHistory as number[]) ?? [];
    if (history.length < 2) return { config: currentConfig };
    const last = history[history.length - 1]!;
    const prev = history[history.length - 2]!;
    const delta = last - prev;
    let { costWeight, parallelismWeight } = currentConfig;
    let adaptation: BetaAdaptation | undefined;
    if (Math.abs(delta) < 0.01) {
      const old = costWeight;
      costWeight = Math.min(0.3, costWeight + 0.02);
      adaptation = { timestamp: Date.now(), field: "costWeight", oldValue: old, newValue: costWeight, reason: "plateau" };
    } else if (delta < 0) {
      const old = costWeight;
      costWeight = Math.max(0.01, costWeight - 0.01);
      adaptation = { timestamp: Date.now(), field: "costWeight", oldValue: old, newValue: costWeight, reason: "decline" };
    }
    parallelismWeight = Math.min(0.15, Math.max(0, parallelismWeight));
    const result: { config: ReplayConfig; adaptation?: BetaAdaptation } = { config: { ...currentConfig, costWeight, parallelismWeight } };
    if (adaptation) result.adaptation = adaptation;
    return result;
  } catch {
    return { config: currentConfig };
  }
}

async function evaluateStrategy(
  store: MemoryStore,
  embed: (text: string) => Promise<number[]>,
  strategy: ReplayStrategy,
  queries: ReplayQuery[],
  config: ReplayConfig = DEFAULT_REPLAY_CONFIG,
): Promise<StrategyScore> {
  let totalScore = 0;
  let totalOverlap = 0;
  const details: StrategyScore["details"] = [];

  for (const query of queries) {
    try {
      let retrievedIds: string[];
      if (strategy.pipeline === "drilldown") {
        const drilldown = await store.drilldownQuery(query.queryText, 5, store.projectName);
        retrievedIds = drilldown.map(r => r.node.id);
      } else {
        const results = await searchNodes(store, embed, query.queryText, {
          limit: 10,
          rerank: true,
          rerankMode: strategy.rerankMode,
          intent: strategy.intent,
          projectName: store.projectName,
        });
        retrievedIds = results.map(r => r.node.id);
      }
      const originalIds = new Set(query.injectedNodeIds);
      const overlapCount = retrievedIds.filter(id => originalIds.has(id)).length;
      const overlapRatio = query.injectedNodeIds.length > 0
        ? overlapCount / query.injectedNodeIds.length
        : 0;

      // Self-row agreement: a strategy reproducing what IT injected is
      // tautological (overlap → 1.0 by construction), which would freeze the
      // loop. Revoke that credit proportionally to negative outcome
      // (g = clamp01(1 + min(fb, 0))): neutral/positive keeps incumbency,
      // a downvoted producer's agreement slides toward 0 so an overlapping
      // challenger can take the seat. Non-producers always keep real overlap
      // (their agreement is a genuine counterfactual).
      const agreement = producedByStrategy(strategy, query.originalStrategy)
        ? Math.max(0, 1 + Math.min(query.feedbackScore, 0))
        : overlapRatio;

      const queryScore = agreement * 0.6 + feedbackTermFor(strategy, query);
      totalScore += queryScore;
      totalOverlap += overlapCount;

      details.push({
        query: query.queryText.slice(0, 60),
        score: queryScore,
        overlapCount,
        retrievedCount: retrievedIds.length,
      });
    } catch {
      details.push({
        query: query.queryText.slice(0, 60),
        score: 0,
        overlapCount: 0,
        retrievedCount: 0,
      });
    }
  }

  const qualityScore = queries.length > 0 ? totalScore / queries.length : 0;
  const costPenalty = estimateCostPenalty(strategy, queries.length);
  const parallelismBonus = estimateParallelismBonus(strategy);

  const avgScore = qualityScore
    * (1 - config.costWeight * costPenalty)
    + config.parallelismWeight * parallelismBonus;

  return {
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    avgScore,
    qualityScore,
    costPenalty,
    parallelismBonus,
    queriesTested: queries.length,
    totalOverlap,
    details,
  };
}

/**
 * Replay all memory-search queries from a session against alternative
 * retrieval strategies. Returns the best-performing strategy.
 *
 * This is the "dreaming" phase of Dream-RSI: cheaply evaluating many
 * candidate policies against historical outcomes without re-running
 * the real agent.
 */
export async function replaySessionQueries(
  store: MemoryStore,
  embed: (text: string) => Promise<number[]>,
  sessionId: string,
  replayConfig?: Partial<ReplayConfig>,
): Promise<ReplayResult> {
  const cfg = { ...DEFAULT_REPLAY_CONFIG, ...replayConfig };
  const allMetrics = await store.getInjectionMetrics(200);

  const sessionMetrics = allMetrics.filter(m => m.sessionId === sessionId);
  const otherSessionMetrics = allMetrics.filter(m => m.sessionId !== sessionId);

  const queries: ReplayQuery[] = sessionMetrics
    .filter(m => m.queryText && m.queryText.length > 2 && (m.postRerankIds?.length ?? 0) > 0)
    .map(m => ({
      queryText: m.queryText!,
      originalStrategy: m.rerankStrategy ?? "unknown",
      injectedNodeIds: m.postRerankIds ?? [],
      feedbackScore: computeFeedbackScore(m),
    }));

  const otherSessions = new Map<string, ReplayQuery[]>();
  for (const m of otherSessionMetrics) {
    if (!m.queryText || m.queryText.length <= 2) continue;
    if (!m.postRerankIds || m.postRerankIds.length === 0) continue;
    const arr = otherSessions.get(m.sessionId) ?? [];
    arr.push({
      queryText: m.queryText!,
      originalStrategy: m.rerankStrategy ?? "unknown",
      injectedNodeIds: m.postRerankIds ?? [],
      feedbackScore: computeFeedbackScore(m),
    });
    otherSessions.set(m.sessionId, arr);
  }

  const uniqueSessionIds = new Set(allMetrics.map(m => m.sessionId));

  if (queries.length === 0) {
    return { bestStrategyId: "keyword", strategies: [], queriesReplayed: 0, sessionsReplayed: uniqueSessionIds.size };
  }

  let previousScore: number | undefined;
  let scoreHistory: number[] = [];
  try {
    const existing = await store.getNodeByLabel("project", "dream-rsi:active-strategy");
    const meta = (existing.metadata as Record<string, unknown> | null) ?? {};
    previousScore = meta.score as number | undefined;
    scoreHistory = (meta.scoreHistory as number[]) ?? [];
  } catch {
    /* no previous strategy */
  }

  const scoreHistoryForStrategy = selectStrategies(scoreHistory);

  let bestResult: ReplayResult = { bestStrategyId: "keyword", strategies: [], queriesReplayed: queries.length, sessionsReplayed: uniqueSessionIds.size, revision: 0 };

  for (let revision = 0; revision <= cfg.maxRevisions; revision++) {
    const scores: StrategyScore[] = [];
    for (const strategy of scoreHistoryForStrategy) {
      const strategyScore = await evaluateStrategy(store, embed, strategy, queries, cfg);
      scores.push(strategyScore);
    }

    if (otherSessions.size > 0) {
      const otherQueries = [...otherSessions.values()].flat().slice(0, 50);
      for (const score of scores) {
        const strategy = scoreHistoryForStrategy.find(s => s.id === score.strategyId);
        if (!strategy) continue;
        const crossScore = await evaluateStrategy(store, embed, strategy, otherQueries, cfg);
        score.avgScore = (score.avgScore + crossScore.avgScore) / 2;
        score.qualityScore = (score.qualityScore + crossScore.qualityScore) / 2;
      }
    }

    scores.sort((a, b) => b.avgScore - a.avgScore);

    const candidate: ReplayResult = {
      bestStrategyId: scores[0]!.strategyId,
      strategies: scores,
      queriesReplayed: queries.length,
      sessionsReplayed: uniqueSessionIds.size,
      revision,
      ...(previousScore !== undefined ? { previousScore } : {}),
    };

    if (revision === 0) {
      bestResult = candidate;
    } else {
      const bestScore = scores[0]!.avgScore;
      if (previousScore !== undefined && bestScore < previousScore) {
        memLog("info", "dream-rsi", `Revision ${revision}: score ${bestScore.toFixed(3)} < previous ${previousScore.toFixed(3)}, reverting`);
        bestResult = { ...bestResult, revision: revision - 1 };
        break;
      }
      bestResult = candidate;
      if (bestScore === previousScore) {
        memLog("info", "dream-rsi", `Revision ${revision}: score converged at ${bestScore.toFixed(3)}`);
        break;
      }
      previousScore = bestScore;
    }
  }

  return bestResult;
}

/**
 * Persist the winning strategy to a memory node so the next session
 * can read it. This closes the recursive loop: the best strategy
 * from replay is applied to the next session's retrieval.
 */
export async function persistBestStrategy(
  store: MemoryStore,
  result: ReplayResult,
  betaAdaptation?: BetaAdaptation,
  options?: { switchMargin?: number },
): Promise<void> {
  if (result.queriesReplayed === 0 || result.strategies.length === 0) return;

  const existing = await store.getNodeByLabel("project", "dream-rsi:active-strategy").catch(() => null);
  const existingMeta = (existing?.metadata as Record<string, unknown> | null) ?? {};
  const prevHistory = (existingMeta.scoreHistory as number[] | undefined) ?? [];
  const previousStrategyId = existingMeta.strategyId as string | undefined;
  const previousScore = existingMeta.score as number | undefined;

  let winning = result.strategies.find(s => s.strategyId === result.bestStrategyId);
  if (!winning) return;

  // Hysteresis: hold the incumbent seat unless a challenger beats it this
  // round by at least switchMargin (compared on the SAME query set). Ties and
  // near-ties keep the current strategy — prevents churn from score noise.
  // If the incumbent was not evaluated this round (selectStrategies subset),
  // there is no fair comparison, so the winner takes the seat.
  const margin = options?.switchMargin ?? 0.05;
  if (previousStrategyId !== undefined && previousStrategyId !== winning.strategyId) {
    const incumbentNow = result.strategies.find(s => s.strategyId === previousStrategyId);
    if (incumbentNow && winning.avgScore < incumbentNow.avgScore + margin) {
      winning = incumbentNow;
    }
  }

  const content = [
    `## Dream-RSI Active Strategy`,
    ``,
    `**Strategy:** ${winning.strategyLabel} (${winning.strategyId})`,
    `**Score:** ${winning.avgScore.toFixed(3)} (quality=${winning.qualityScore.toFixed(3)}, cost=${winning.costPenalty.toFixed(2)}, parallelism=${winning.parallelismBonus.toFixed(2)})`,
    `**Queries tested:** ${winning.queriesTested}`,
    `**Total overlap:** ${winning.totalOverlap}`,
    `**Revisions:** ${result.revision ?? 0}/${DEFAULT_REPLAY_CONFIG.maxRevisions}`,
    `**Updated:** ${new Date().toISOString()}`,
    ``,
    `### All Strategies`,
    ...result.strategies.map(s =>
      `- ${s.strategyLabel}: score=${s.avgScore.toFixed(3)} quality=${s.qualityScore.toFixed(3)} overlap=${s.totalOverlap}${s.strategyId === winning.strategyId ? " ★" : ""}`
    ),
  ].join("\n");

  const scoreHistory = [...prevHistory, winning.avgScore].slice(-5);

  if (existing) {
    await store.updateNode(existing.id, {
      content,
      confidence: Math.min(existing.confidence + 0.1, 1.0),
      metadata: {
        strategyId: winning.strategyId,
        score: winning.avgScore,
        scoreHistory,
        queriesReplayed: result.queriesReplayed,
        sessionsReplayed: result.sessionsReplayed,
        updatedAt: Date.now(),
      },
    });
  } else {
    await store.createNode({
      scope: "project",
      label: "dream-rsi:active-strategy",
      content,
      level: 0,
      importance: 0.7,
      type: "fact",
      source: "auto_extract",
      tags: ["dream-rsi", "strategy", `strategy:${winning.strategyId}`],
      metadata: {
        strategyId: winning.strategyId,
        score: winning.avgScore,
        scoreHistory: [winning.avgScore],
        queriesReplayed: result.queriesReplayed,
        sessionsReplayed: result.sessionsReplayed,
        updatedAt: Date.now(),
      },
    });
  }

  // History/trend must reflect the seat that was actually persisted (the
  // effective winner after a hold), not the raw round winner.
  await recordHistoryOnPersist(store, previousStrategyId, previousScore, { ...result, bestStrategyId: winning.strategyId }, betaAdaptation);
}

/**
 * Read the active strategy from the memory node. Returns the rerank mode
 * to use, or undefined if no strategy has been learned yet.
 */
export async function getActiveRerankMode(
  store: MemoryStore,
): Promise<"keyword" | "cross-encoder" | undefined> {
  try {
    const node = await store.getNodeByLabel("project", "dream-rsi:active-strategy");
    const strategyId = (node.metadata as Record<string, unknown> | null)?.strategyId as string | undefined;
    if (!strategyId) return undefined;

    if (strategyId === "cross-encoder" || strategyId === "intent-debug" || strategyId === "intent-read" || strategyId === "intent-edit") {
      return "cross-encoder";
    }
    if (strategyId === "keyword") {
      return "keyword";
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function formatReplayResult(result: ReplayResult): string {
  if (result.queriesReplayed === 0) {
    return "No queries to replay — no injection metrics for this session.";
  }

  const lines: string[] = [
    `Dream-RSI Replay: ${result.queriesReplayed} queries from ${result.sessionsReplayed} session(s) evaluated across ${result.strategies.length} strategies`,
    result.revision !== undefined ? `Revisions: ${result.revision}/${DEFAULT_REPLAY_CONFIG.maxRevisions}` : "",
    result.previousScore !== undefined ? `Previous score: ${result.previousScore.toFixed(3)}` : "",
    "",
  ];

  for (const s of result.strategies) {
    const marker = s.strategyId === result.bestStrategyId ? " ★ BEST" : "";
    const costTag = s.costPenalty > 0 ? ` cost=${s.costPenalty.toFixed(2)}` : "";
    const bonusTag = s.parallelismBonus > 0 ? ` +${s.parallelismBonus.toFixed(2)}` : "";
    lines.push(
      `  ${s.strategyLabel}: score=${s.avgScore.toFixed(3)} quality=${s.qualityScore.toFixed(3)}${costTag}${bonusTag} overlap=${s.totalOverlap}${marker}`,
    );
  }

  lines.push("");
  lines.push(`Recommendation: use "${result.bestStrategyId}" for next session`);

  return lines.join("\n");
}

export interface StrategySwitch {
  timestamp: number;
  from: string;
  to: string;
  scoreBefore: number | undefined;
  scoreAfter: number;
}

export interface QualityTrendPoint {
  timestamp: number;
  strategyId: string;
  score: number;
  queriesReplayed: number;
  sessionsReplayed: number;
}

export interface BetaAdaptation {
  timestamp: number;
  field: string;
  oldValue: number;
  newValue: number;
  reason: string;
}

const HISTORY_NODE_LABEL = "dream-rsi:strategy-history";
const MAX_HISTORY_ENTRIES = 50;

async function appendStrategyHistory(
  store: MemoryStore,
  entry: {
    switch?: StrategySwitch;
    trend: QualityTrendPoint;
    adaptation?: BetaAdaptation;
  },
): Promise<void> {
  try {
    const node = await store.getNodeByLabel("project", HISTORY_NODE_LABEL).catch(() => null);
    const meta = (node?.metadata as Record<string, unknown> | null) ?? {};
    const switches = (meta.switches as StrategySwitch[]) ?? [];
    const trends = (meta.trends as QualityTrendPoint[]) ?? [];
    const adaptations = (meta.adaptations as BetaAdaptation[]) ?? [];

    if (entry.switch) switches.push(entry.switch);
    trends.push(entry.trend);
    if (entry.adaptation) adaptations.push(entry.adaptation);

    const trimmedSwitches = switches.slice(-MAX_HISTORY_ENTRIES);
    const trimmedTrends = trends.slice(-MAX_HISTORY_ENTRIES);
    const trimmedAdaptations = adaptations.slice(-MAX_HISTORY_ENTRIES);

    const content = `## Dream-RSI Strategy History\n\nLast ${trimmedTrends.length} quality trend points, ${trimmedSwitches.length} strategy switches, ${trimmedAdaptations.length} beta adaptations.`;

    if (node) {
      await store.updateNode(node.id, {
        content,
        metadata: {
          switches: trimmedSwitches,
          trends: trimmedTrends,
          adaptations: trimmedAdaptations,
          updatedAt: Date.now(),
        },
      });
    } else {
      await store.createNode({
        scope: "project",
        label: HISTORY_NODE_LABEL,
        content,
        level: 0,
        importance: 0.6,
        type: "fact",
        source: "auto_extract",
        tags: ["dream-rsi", "history"],
        metadata: {
          switches: trimmedSwitches,
          trends: trimmedTrends,
          adaptations: trimmedAdaptations,
          updatedAt: Date.now(),
        },
      });
    }
  } catch (err) {
    memLog("warn", "dream-rsi", `Failed to record strategy history: ${err}`);
  }
}

export async function recordHistoryOnPersist(
  store: MemoryStore,
  previousStrategyId: string | undefined,
  previousScore: number | undefined,
  result: ReplayResult,
  betaAdaptation?: BetaAdaptation,
): Promise<void> {
  if (result.queriesReplayed === 0 || result.strategies.length === 0) return;
  const winning = result.strategies.find(s => s.strategyId === result.bestStrategyId);
  if (!winning) return;

  const sw: StrategySwitch | undefined = previousStrategyId && previousStrategyId !== result.bestStrategyId
    ? { timestamp: Date.now(), from: previousStrategyId, to: result.bestStrategyId, scoreBefore: previousScore, scoreAfter: winning.avgScore }
    : undefined;

  const entry: { trend: QualityTrendPoint; switch?: StrategySwitch; adaptation?: BetaAdaptation } = {
    trend: {
      timestamp: Date.now(),
      strategyId: result.bestStrategyId,
      score: winning.avgScore,
      queriesReplayed: result.queriesReplayed,
      sessionsReplayed: result.sessionsReplayed,
    },
  };
  if (sw) entry.switch = sw;
  if (betaAdaptation) entry.adaptation = betaAdaptation;

  await appendStrategyHistory(store, entry);
}

export interface DreamRsiDashboardData {
  activeStrategy: {
    strategyId: string;
    score: number;
    scoreHistory: number[];
    queriesReplayed: number;
    sessionsReplayed: number;
    updatedAt: number;
  } | null;
  history: {
    switches: StrategySwitch[];
    trends: QualityTrendPoint[];
    adaptations: BetaAdaptation[];
  };
  injectionStats: {
    strategy: string;
    count: number;
    avgEffectiveness: number;
    avgUpvotes: number;
    avgDownvotes: number;
  }[];
}

export async function getDreamRsiDashboard(store: MemoryStore): Promise<DreamRsiDashboardData> {
  let activeStrategy: DreamRsiDashboardData["activeStrategy"] = null;
  try {
    const node = await store.getNodeByLabel("project", "dream-rsi:active-strategy");
    const meta = (node.metadata as Record<string, unknown> | null) ?? {};
    activeStrategy = {
      strategyId: (meta.strategyId as string) ?? "unknown",
      score: (meta.score as number) ?? 0,
      scoreHistory: (meta.scoreHistory as number[]) ?? [],
      queriesReplayed: (meta.queriesReplayed as number) ?? 0,
      sessionsReplayed: (meta.sessionsReplayed as number) ?? 0,
      updatedAt: (meta.updatedAt as number) ?? 0,
    };
  } catch { /* no active strategy yet */ }

  let history: DreamRsiDashboardData["history"] = { switches: [], trends: [], adaptations: [] };
  try {
    const node = await store.getNodeByLabel("project", HISTORY_NODE_LABEL);
    const meta = (node.metadata as Record<string, unknown> | null) ?? {};
    history = {
      switches: (meta.switches as StrategySwitch[]) ?? [],
      trends: (meta.trends as QualityTrendPoint[]) ?? [],
      adaptations: (meta.adaptations as BetaAdaptation[]) ?? [],
    };
  } catch { /* no history yet */ }

  let injectionStats: DreamRsiDashboardData["injectionStats"] = [];
  try {
    const node = await store.getNodeByLabel("project", HISTORY_NODE_LABEL).catch(() => null);
    const meta = (node?.metadata as Record<string, unknown> | null) ?? {};
    const trends = (meta.trends as QualityTrendPoint[]) ?? [];
    const strategyCounts = new Map<string, { count: number; scoreSum: number }>();
    for (const t of trends) {
      const existing = strategyCounts.get(t.strategyId) ?? { count: 0, scoreSum: 0 };
      existing.count++;
      existing.scoreSum += t.score;
      strategyCounts.set(t.strategyId, existing);
    }
    injectionStats = [...strategyCounts.entries()].map(([strategy, data]) => ({
      strategy,
      count: data.count,
      avgEffectiveness: data.count > 0 ? data.scoreSum / data.count : 0,
      avgUpvotes: 0,
      avgDownvotes: 0,
    }));
  } catch { /* no stats yet */ }

  return { activeStrategy, history, injectionStats };
}
