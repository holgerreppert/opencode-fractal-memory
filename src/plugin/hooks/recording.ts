import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import { predictiveRateToolCall } from "../../application";
import { lastSearchResults } from "../../tools/shared";
import type { HookHandler } from "./types";

const FOLLOWUP_TOOLS = new Set(["edit", "bash", "write", "replace", "create"]);

export function createRecordingHandler(store: MemoryStore, config: MemConfig): HookHandler {
  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; sessionID?: string; args?: Record<string, unknown> };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      const success = !out.metadata?.error;

      if (input.tool?.startsWith("memory_")) {
        await store.recordMemoryToolCall(
          input.sessionID ?? "unknown",
          input.tool,
          input.args,
        );

        if (config.predictiveRating?.enabled) {
          predictiveRateToolCall(store, { tool: input.tool ?? "", args: input.args, sessionID: input.sessionID }, out as { metadata?: { error?: unknown } }, config.predictiveRating).catch(err =>
            memLog("warn", "predictive-rating", "Rating failed", { error: String(err) })
          );
        }
      }

      // Boost last search results when a follow-up tool succeeds (edit/bash/write after search)
      if (success && FOLLOWUP_TOOLS.has(input.tool ?? "") && lastSearchResults.length > 0) {
        const nodes = lastSearchResults.slice(0, 5);
        for (const n of nodes) {
          try {
            const node = await store.getNode(n.id);
            const newScore = Math.min(5, (node.usefulnessScore ?? 0) + 0.1);
            await store.updateNode(n.id, { usefulnessScore: newScore, timesHelpful: (node.timesHelpful ?? 0) + 1 });
          } catch { /* node may have been deleted */ }
        }
        memLog("debug", "predictive-rating", `Boosted ${nodes.length} search results after ${input.tool}`);
      }
    },
  };
}
