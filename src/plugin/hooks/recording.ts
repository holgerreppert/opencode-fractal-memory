import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../config";
import { memLog } from "../../logging";
import { predictiveRateToolCall } from "../../hooks";
import type { HookHandler } from "./types";

export function createRecordingHandler(store: MemoryStore, config: MemConfig): HookHandler {
  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; sessionID?: string; args?: Record<string, unknown> };
      const out = output as { output?: string; metadata?: Record<string, unknown> };

      if (!input.tool?.startsWith("memory_")) return;

      await store.recordMemoryToolCall(
        input.sessionID ?? "unknown",
        input.tool,
        input.args,
      );

      if (config.predictiveRating?.enabled) {
        predictiveRateToolCall(store, input as any, out as any, config.predictiveRating).catch(err =>
          memLog("warn", "predictive-rating", "Rating failed", { error: String(err) })
        );
      }
    },
  };
}
