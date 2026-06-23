import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../config";
import { writeCompressLog } from "../../logging";
import { compressCommandOutput } from "../../hooks/compress-output";
import type { HookHandler } from "./types";

export function createCompressionHandler(store: MemoryStore, config: MemConfig): HookHandler {
  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: { command?: string }; sessionID?: string };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      const compressConfig = config.commandCompression;
      if (!compressConfig?.enabled || input.tool !== "bash") return;

      const success = !(out.metadata?.error);
      const cmd = input.args?.command ?? "";
      const raw = (out.output ?? "") as string;
      const failed = !success || !!out.metadata?.error;
      const t0 = performance.now();
      const compressed = compressCommandOutput(cmd, raw, failed, compressConfig);
      const durationMs = performance.now() - t0;

      try {
        if (compressed !== null) {
          const originalLines = raw.split("\n").length;
          const compressedLines = compressed.output.split("\n").length;
          const reductionPct = raw.length > 0 ? Math.round((1 - compressed.output.length / raw.length) * 100) : 0;
          const banner = `[Compressed via ${compressed.strategy} — ${raw.length}→${compressed.output.length} chars]\n`;
          out.output = banner + compressed.output;
          out.metadata = {
            ...((out.metadata as Record<string, unknown>) ?? {}),
            compressed: true,
            compressStrategy: compressed.strategy,
          };
          writeCompressLog({
            action: "applied",
            strategy: compressed.strategy,
            cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
            original_chars: raw.length,
            compressed_chars: compressed.output.length,
            original_lines: originalLines,
            compressed_lines: compressedLines,
            reduction_pct: reductionPct,
            duration_ms: Math.round(durationMs),
            failed: failed ? 1 : 0,
          });
          store.recordCompressionStat({
            sessionId: input.sessionID ?? "unknown",
            command: cmd,
            strategy: compressed.strategy,
            originalChars: raw.length,
            compressedChars: compressed.output.length,
            durationMs,
          }).catch(() => {});
        } else {
          writeCompressLog({
            action: "skipped",
            cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
            original_chars: raw.length,
            failed: failed ? 1 : 0,
            duration_ms: Math.round(durationMs),
            reason: failed ? "always-full-on-failure" : "no-strategy-matched",
          });
        }
      } catch (err) {
        writeCompressLog({
          action: "error",
          cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
          error: String(err).slice(0, 100),
        });
      }
    },
  };
}
