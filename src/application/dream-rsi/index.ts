/**
 * Dream-RSI Recursive Self-Improvement Loop
 *
 * Implements the 3-stage loop from Dream-RSI (arXiv 2609.14858):
 *   1. Online Explore — lesson/work extraction at session.idle
 *   2. Construct Simulator — replay evaluator re-runs queries offline
 *   3. Dreaming-based Policy Improvement — best strategy stored for next round
 *
 * The loop closes when the replay result feeds back into retrieval config,
 * making the next session's retrieval better than the last.
 */

export { replaySessionQueries, formatReplayResult, persistBestStrategy, getActiveRerankMode, adaptBeta, selectStrategies, recordHistoryOnPersist, getDreamRsiDashboard } from "./replay-evaluator";
export type { ReplayResult, ReplayStrategy, StrategyScore, ReplayConfig, StrategySwitch, QualityTrendPoint, BetaAdaptation, DreamRsiDashboardData } from "./replay-evaluator";

export { sweepNodeRatings } from "./node-sweep";
export type { SweepResult } from "./node-sweep";

export { classifyExtraction, classifyRootCause, detectClustering } from "./exploration-rules";
export type { ExplorationClassification } from "./exploration-rules";
