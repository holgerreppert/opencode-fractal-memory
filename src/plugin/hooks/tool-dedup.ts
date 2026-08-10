import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import { createToolDedupCache, type ToolDedupConfig } from "../../application/tool-dedup";
import type { HookHandler } from "./types";

export function createToolDedupHandler(config: MemConfig): HookHandler {
  const tdConfig = config.toolDedup as ToolDedupConfig | undefined;
  if (!tdConfig?.enabled) return {};

  const cache = createToolDedupCache(tdConfig.maxCacheEntries ?? 500);

  return {
    // NOTE: `tool.before` output only exposes `{ args }` — `out.output`/metadata
    // mutations are SILENTLY DROPPED there (see re-read-elimination bug fix
    // 2026-08-09). The serve happens in `tool.after` (writable `{ output,
    // metadata }`). The tool still executes (this API has no skip mechanism),
    // but the output is replaced with the cached copy + `deduped` metadata so
    // downstream handlers (recording, compression) can treat it as a duplicate.
    "tool.before": async () => {
      cache.nextTurn();
    },

    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: Record<string, unknown> };
      const out = output as { output?: string; metadata?: Record<string, unknown> };

      if (out.metadata?.deduped) return;

      if (!input.tool || input.tool === "bash") return;

      const raw = (out.output ?? "") as string;

      // Serve from cache first: identical tool+args that already produced this
      // output → replace the fresh output with the cached copy + dedup marker
      // (gives byte-stable output + downstream visibility via `deduped`).
      const cached = cache.check(input.tool, input.args ?? {}, tdConfig);
      if (cached) {
        out.output = cached.output;
        out.metadata = {
          ...((out.metadata as Record<string, unknown>) ?? {}),
          deduped: true,
          dedupSource: "tool-dedup-cache",
        };
        memLog("debug", "tool-dedup", `Served cached output for ${input.tool}`, {
          sig: `${input.tool}::${JSON.stringify(input.args).slice(0, 80)}`,
        });
        return;
      }

      cache.record(input.tool, input.args ?? {}, raw);
    },
  };
}
