import * as fs from "node:fs";
import type { MemConfig } from "../../config";
import { writeFileSumLog } from "../../logging";
import { cacheReadResult, checkUnchangedRead, configureReadCache, getReadCacheSize, getReadCacheMaxSize, invalidateCacheEntry } from "../../hooks/re-read-elimination";
import type { HookHandler } from "./types";

export function createReReadEliminationHandler(config: MemConfig): HookHandler {
  const rrConfig = config.reReadElimination;
  if (rrConfig?.enabled) {
    configureReadCache(rrConfig.maxCacheSize ?? 100);
    writeFileSumLog("RE-READ", { action: "init", max_cache: rrConfig.maxCacheSize ?? 100 });
  }

  return {
    "tool.before": async (_input: unknown, output: unknown) => {
      if (!rrConfig?.enabled) return;
      const input = _input as { tool?: string; args?: { filePath?: string; offset?: number } };
      if (input.tool !== "read") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      if (input.args?.offset) {
        writeFileSumLog("RE-READ", { action: "skipped-offset", file: filePath });
        return;
      }

      const result = checkUnchangedRead(filePath);
      if (!result) {
        writeFileSumLog("RE-READ", { action: "cache-miss-or-changed", file: filePath, cache_size: getReadCacheSize() });
        return;
      }

      const out = output as { output?: string; metadata?: Record<string, unknown> };
      out.output = result.content;
      out.metadata = {
        ...((out.metadata as Record<string, unknown>) ?? {}),
        reread_eliminated: true,
      };
      writeFileSumLog("RE-READ", {
        action: "cache-hit",
        file: filePath,
        chars: result.content.length,
        since_turn: result.turn,
        cache_size: getReadCacheSize(),
        max_cache: getReadCacheMaxSize(),
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
      if (!raw || raw.length < 80) {
        writeFileSumLog("RE-READ", { action: "skipped-too-small", file: filePath, chars: raw.length });
        return;
      }

      try {
        await cacheReadResult(filePath, raw);
        writeFileSumLog("RE-READ", {
          action: "cached",
          file: filePath,
          chars: raw.length,
          lines: raw.split("\n").length,
          cache_size: getReadCacheSize(),
          max_cache: getReadCacheMaxSize(),
        });
      } catch (err) {
        writeFileSumLog("RE-READ", { action: "cache-error", file: filePath, error: String(err).slice(0, 80) });
      }
    },
  };
}
