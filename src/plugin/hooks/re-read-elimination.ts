import type { MemConfig } from "../../infrastructure/config/config";
import { injectionMarker, recordInjection } from "../../application/injection-visibility";
import { writeFileSumLog } from "../../logging";
import { cacheReadResult, checkUnchangedRead, configureReadCache, getReadCacheSize, getReadCacheMaxSize } from "../../application/re-read-elimination";
import type { HookHandler } from "./types";

export function createReReadEliminationHandler(config: MemConfig): HookHandler {
  const rrConfig = config.reReadElimination;
  if (rrConfig?.enabled) {
    configureReadCache(rrConfig.maxCacheSize ?? 100);
    writeFileSumLog("RE-READ", { action: "init", max_cache: rrConfig.maxCacheSize ?? 100 });
  }

  return {
    // NOTE: `tool.before` output only exposes `{ args }` (see @opencode-ai/plugin
    // v1.4.x types) — `out.output`/`out.metadata` mutations are silently dropped
    // there. The serve MUST happen in `tool.after`, which exposes a writable
    // `{ output, metadata }` (same pattern as graph-search-hint / rg-footgun).
    "tool.after": async (_input: unknown, output: unknown) => {
      if (!rrConfig?.enabled) return;
      const input = _input as { tool?: string; args?: { filePath?: string; offset?: number } };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      if (input.tool !== "read") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      if (input.args?.offset) {
        writeFileSumLog("RE-READ", { action: "skipped-offset", file: filePath });
        return;
      }

      // Serve from cache first: if the file is unchanged since the previous
      // read, the model already has the full content in context — replace the
      // fresh output with the cached copy + marker instead of re-shipping it.
      const cached = checkUnchangedRead(filePath);
      if (cached) {
        const marker = injectionMarker(config, "re-read-elimination", `served cached content for ${filePath} (since turn ${cached.turn})`);
        out.output = marker ? marker + "\n" + cached.content : cached.content;
        out.metadata = {
          ...((out.metadata as Record<string, unknown>) ?? {}),
          reread_eliminated: true,
        };
        recordInjection(config, "re-read-elimination", `cached read of ${filePath} (${cached.content.length} chars)`);
        writeFileSumLog("RE-READ", {
          action: "cache-hit",
          file: filePath,
          chars: cached.content.length,
          since_turn: cached.turn,
          cache_size: getReadCacheSize(),
          max_cache: getReadCacheMaxSize(),
        });
        return;
      }

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
