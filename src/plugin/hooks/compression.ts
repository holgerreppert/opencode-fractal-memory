import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../config";
import { writeCompressLog } from "../../logging";
import { compressCommandOutput, addContentDedup, type CompressConfig } from "../../hooks/compress-output";
import type { HookHandler } from "./types";

const DEDUP_CACHE = new Map<string, { output: string; strategy: string }>();
const SCRATCH_DIR = path.join(os.homedir(), ".config", "opencode", "scratch");

function ensureScratchDir(): void {
  try { fs.mkdirSync(SCRATCH_DIR, { recursive: true }); } catch { /* best-effort */ }
}

function offloadOutput(output: string): string | null {
  ensureScratchDir();
  const hash = createHash("sha256").update(output).digest("hex").slice(0, 16);
  const outPath = path.join(SCRATCH_DIR, `${hash}.out`);
  try {
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, output, "utf-8");
    }
    const lines = output.split("\n").length;
    return `[Output offloaded: ${output.length} chars, ${lines} lines — use \`cat ${outPath}\` to see full]\n`;
  } catch {
    return null;
  }
}

function purgeOldScratch(): void {
  try {
    const cutoff = Date.now() - 86400000;
    for (const f of fs.readdirSync(SCRATCH_DIR)) {
      const fp = path.join(SCRATCH_DIR, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
      }
    }
  } catch { /* best-effort */ }
}

export function createCompressionHandler(store: MemoryStore, config: MemConfig): HookHandler {
  purgeOldScratch();
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
        const deduped = addContentDedup(DEDUP_CACHE, cmd, raw, compressed);

        if (deduped) {
          const strategyLabel = deduped.dedup ? "dedup" : (compressed?.strategy ?? "generic");
          let banner = deduped.dedup
            ? `[Dedup — ${raw.length}→${deduped.output.length} chars (same output seen before)]\n`
            : `[Compressed via ${strategyLabel} — ${raw.length}→${deduped.output.length} chars]\n`;
          let finalOutput = deduped.output;

          const offloadConfig = config.outputOffloading;
          if (offloadConfig?.enabled && !deduped.dedup) {
            const threshold = offloadConfig.thresholdChars ?? 8000;
            if (finalOutput.length > threshold) {
              const refBanner = offloadOutput(finalOutput);
              if (refBanner) {
                banner = `[Compressed via ${strategyLabel} — ${raw.length}→${finalOutput.length} chars, offloaded]\n`;
                finalOutput = refBanner;
              }
            }
          }

          out.output = banner + finalOutput;
          out.metadata = {
            ...((out.metadata as Record<string, unknown>) ?? {}),
            compressed: true,
            compressStrategy: strategyLabel,
            deduped: deduped.dedup,
          };
          writeCompressLog({
            action: deduped.dedup ? "dedup" : "applied",
            strategy: strategyLabel,
            cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
            original_chars: raw.length,
            compressed_chars: deduped.output.length,
            original_lines: raw.split("\n").length,
            compressed_lines: deduped.output.split("\n").length,
            reduction_pct: raw.length > 0 ? Math.round((1 - deduped.output.length / raw.length) * 100) : 0,
            duration_ms: Math.round(durationMs),
            failed: failed ? 1 : 0,
          });
          store.recordCompressionStat({
            sessionId: input.sessionID ?? "unknown",
            command: cmd,
            strategy: strategyLabel,
            originalChars: raw.length,
            compressedChars: deduped.output.length,
            durationMs,
          }).catch(() => {});
        } else {
          writeCompressLog({
            action: "skipped",
            cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
            original_chars: raw.length,
            failed: failed ? 1 : 0,
            duration_ms: Math.round(durationMs),
            reason: compressed === null ? "no-strategy-matched" : "classification-skipped-signal",
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
