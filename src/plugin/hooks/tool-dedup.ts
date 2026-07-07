import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import { createToolDedupCache, type ToolDedupConfig } from "../../application/tool-dedup";
import type { HookHandler } from "./types";

export function createToolDedupHandler(config: MemConfig): HookHandler {
  const tdConfig = config.toolDedup as ToolDedupConfig | undefined;
  if (!tdConfig?.enabled) return {};

  const cache = createToolDedupCache(tdConfig.maxCacheEntries ?? 500);

  return {
    "tool.before": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: Record<string, unknown>; sessionID?: string };
      const out = output as { output?: string; metadata?: Record<string, unknown> };

      cache.nextTurn();

      if (!input.tool || input.tool === "bash") return;

      const result = cache.check(input.tool, input.args ?? {}, tdConfig);
      if (!result) return;

      out.output = result.output;
      out.metadata = {
        ...((out.metadata as Record<string, unknown>) ?? {}),
        deduped: true,
        dedupSource: "tool-dedup-cache",
      };

      memLog("debug", "tool-dedup", `Served cached output for ${input.tool}`, {
        sig: `${input.tool}::${JSON.stringify(input.args).slice(0, 80)}`,
      });
    },

    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: Record<string, unknown> };
      const out = output as { output?: string; metadata?: Record<string, unknown> };

      if (out.metadata?.deduped) return;

      if (!input.tool || input.tool === "bash") return;

      const raw = (out.output ?? "") as string;
      cache.record(input.tool, input.args ?? {}, raw);
    },
  };
}
