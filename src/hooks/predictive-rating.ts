import type { MemoryStore } from "../storage/sqlite";
import { memLog } from "../logging";

export interface PredictiveRatingConfig {
  decayDays: number;
  positiveBoost: number;
  negativePenalty: number;
}

export async function predictiveRateToolCall(
  store: MemoryStore,
  input: { tool: string; args?: Record<string, unknown>; sessionID?: string },
  output: { metadata?: { error?: unknown } },
  config: PredictiveRatingConfig
): Promise<void> {
  const success = output.metadata?.error ? false : true;

  let nodeId: string | undefined;
  const tool = input.tool;
  const args = input.args ?? {};

  if (tool === "memory_get" && (args.id || args.label)) {
    nodeId = args.id as string;
    if (!nodeId && args.label) {
      try {
        const node = await store.getNodeByLabel((args.scope as any) ?? "project", args.label as string);
        nodeId = node.id;
      } catch { /* Not found, skip rating */ return; }
    }
  } else if (tool === "memory_fetch" && args.label) {
    try {
      const node = await store.getNodeByLabel("global", args.label as string);
      nodeId = node.id;
    } catch {
      try {
        const node = await store.getNodeByLabel("project", args.label as string);
        nodeId = node.id;
      } catch { /* Not found in project, skip */ return; }
    }
  } else if (tool === "memory_rate" && (args.id || args.label)) {
    nodeId = args.id as string;
    if (!nodeId && args.label) {
      try {
        const node = await store.getNodeByLabel((args.scope as any) ?? "project", args.label as string);
        nodeId = node.id;
      } catch { /* Not found, skip rating */ return; }
    }
  }

  if (!nodeId) return;

  try {
    const node = await store.getNode(nodeId);
    if (!node) return;

    const currentScore = node.usefulnessScore ?? 0;
    const currentHelpful = node.timesHelpful ?? 0;

    if (tool === "memory_rate") {
      if (args.helpful === true) {
        const newScore = Math.min(5, currentScore + config.positiveBoost);
        await store.updateNode(nodeId, {
          usefulnessScore: newScore,
          timesHelpful: currentHelpful + 1,
        });
        memLog("debug", "predictive-rating", `Boosted ${nodeId.slice(0, 8)} to ${newScore}`);
      } else if (success && args.helpful === false) {
        const newScore = Math.max(0, currentScore - config.negativePenalty);
        await store.updateNode(nodeId, { usefulnessScore: newScore });
        memLog("debug", "predictive-rating", `Penalized ${nodeId.slice(0, 8)} to ${newScore}`);
      }
    } else if (success) {
      const newScore = Math.min(5, currentScore + config.positiveBoost);
      await store.updateNode(nodeId, { usefulnessScore: newScore });
      memLog("debug", "predictive-rating", `Access boost ${nodeId.slice(0, 8)} to ${newScore}`);
    } else {
      const newScore = Math.max(0, currentScore - config.negativePenalty);
      await store.updateNode(nodeId, { usefulnessScore: newScore });
      memLog("debug", "predictive-rating", `Failure penalty ${nodeId.slice(0, 8)} to ${newScore}`);
    }
  } catch (err) {
    memLog("warn", "predictive-rating", "Rating update failed", { error: String(err) });
  }
}

export async function applyScoreDecay(
  store: MemoryStore,
  config: PredictiveRatingConfig
): Promise<string> {
  const decayed = await store.runScoreDecay(config.decayDays);
  return `Predictive rating: decayed ${decayed} nodes`;
}
