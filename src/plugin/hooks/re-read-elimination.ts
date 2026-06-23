import * as fs from "node:fs";
import type { MemConfig } from "../../config";
import { writeFileSumLog } from "../../logging";
import { cacheReadResult, checkUnchangedRead, configureReadCache, invalidateCacheEntry } from "../../hooks/re-read-elimination";
import type { HookHandler } from "./types";

export function createReReadEliminationHandler(config: MemConfig): HookHandler {
  const rrConfig = config.reReadElimination;
  if (rrConfig?.enabled) {
    configureReadCache(rrConfig.maxCacheSize ?? 100);
  }

  return {
    "tool.before": async (_input: unknown, output: unknown) => {
      if (!rrConfig?.enabled) return;
      const input = _input as { tool?: string; args?: { filePath?: string; offset?: number } };
      if (input.tool !== "read") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      if (input.args?.offset) return;

      const result = checkUnchangedRead(filePath);
      if (!result) return;

      const out = output as { output?: string; metadata?: Record<string, unknown> };
      out.output = result.content;
      out.metadata = {
        ...((out.metadata as Record<string, unknown>) ?? {}),
        reread_eliminated: true,
      };
      writeFileSumLog("SKELETONIZE", {
        action: "re-read-eliminated",
        file: filePath,
        chars: result.content.length,
        since_turn: result.turn,
      });
    },

    "tool.after": async (_input: unknown, output: unknown) => {
      if (!rrConfig?.enabled) return;
      const input = _input as { tool?: string; args?: { filePath?: string; offset?: number } };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      if (input.tool !== "read") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      if (input.args?.offset) return;

      if ((out.metadata as Record<string, unknown> | undefined)?.reread_eliminated) {
        return;
      }

      const raw = (out.output ?? "") as string;
      if (!raw || raw.length < 80) return;

      try {
        await cacheReadResult(filePath, raw);
      } catch {
        /* best-effort */
      }
    },
  };
}
