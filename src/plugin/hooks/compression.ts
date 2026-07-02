import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import { writeCompressLog } from "../../logging";
import { compressCommandOutput, addContentDedup, tryDeltaCompression, updateDeltaCache, type FuzzyDedupConfig } from "../../application/command-compression";
import type { HookHandler } from "./types";

const DEDUP_CACHE = new Map<string, { output: string; strategy: string }>();
const DELTA_CACHE = new Map<string, { raw: string; strategy: string }>();
const SCRATCH_DIR = path.join(os.homedir(), ".config", "opencode", "scratch");

function ensureScratchDir(): void {
  try { fs.mkdirSync(SCRATCH_DIR, { recursive: true }); } catch { /* best-effort */ }
}

function contentSnippet(text: string, maxChars = 120): string {
  if (!text) return "";
  const lines = text.split("\n");
  let snippet = "";
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed) snippet += (snippet ? "↵" : "") + trimmed.slice(0, Math.min(trimmed.length, 80));
    if (trimmed.length > 80) snippet += "…";
    if (snippet.length >= maxChars) break;
  }
  return snippet.slice(0, maxChars);
}

function contentPreview(text: string, maxChars = 2000): string {
  if (!text || text.length <= maxChars) return text ?? "";
  return text.slice(0, maxChars) + "\n… [truncated]";
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

async function purgeOldScratch(): Promise<void> {
  try {
    const cutoff = Date.now() - 86400000;
    const entries = await fs.promises.readdir(SCRATCH_DIR);
    for (const f of entries) {
      const fp = path.join(SCRATCH_DIR, f);
      try {
        const stat = await fs.promises.stat(fp);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(fp);
        }
      } catch { /* best-effort per-file */ }
    }
  } catch { /* best-effort */ }
}

export function createCompressionHandler(store: MemoryStore, config: MemConfig): HookHandler {
  purgeOldScratch().catch(() => { /* empty */ });
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

      const deltaResult = tryDeltaCompression(DELTA_CACHE, cmd, raw, compressConfig);
      if (deltaResult) {
        updateDeltaCache(DELTA_CACHE, cmd, raw, deltaResult.strategy, compressConfig?.deltaMaxCacheSize ?? 50);
        const durationMs = performance.now() - t0;
        out.output = `[${raw.length}→${deltaResult.output.length} chars — delta from previous run]\n${deltaResult.output}`;
        out.metadata = {
          ...((out.metadata as Record<string, unknown>) ?? {}),
          compressed: true,
          compressStrategy: "delta",
        };
        writeCompressLog({
          action: "delta",
          strategy: "delta",
          cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
          original_chars: raw.length,
          compressed_chars: deltaResult.output.length,
          original_lines: raw.split("\n").length,
          compressed_lines: deltaResult.output.split("\n").length,
          reduction_pct: raw.length > 0 ? Math.round((1 - deltaResult.output.length / raw.length) * 100) : 0,
          duration_ms: Math.round(durationMs),
          failed: failed ? 1 : 0,
          before_snippet: contentSnippet(raw, 120),
          after_snippet: contentSnippet(deltaResult.output, 120),
        });
        store.recordCompressionStat({
          sessionId: input.sessionID ?? "unknown",
          command: cmd,
          strategy: "delta",
          originalChars: raw.length,
          compressedChars: deltaResult.output.length,
          originalLines: raw.split("\n").length,
          compressedLines: deltaResult.output.split("\n").length,
          cmdPreview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
          originalPreview: contentPreview(raw),
          compressedPreview: contentPreview(deltaResult.output),
          durationMs,
        }).catch((err) => memLog("error", "compress", "Failed to record delta compression stat", { error: String(err) }));
        return;
      }

      const compressed = compressCommandOutput(cmd, raw, failed, compressConfig);
      const durationMs = performance.now() - t0;

      if (compressed) {
        updateDeltaCache(DELTA_CACHE, cmd, raw, compressed.strategy, compressConfig?.deltaMaxCacheSize ?? 50);
      }

      try {
        const fuzzyConfig: FuzzyDedupConfig = {
          enabled: compressConfig?.fuzzyDedupEnabled ?? true,
          similarityThreshold: compressConfig?.fuzzyDedupThreshold ?? 0.85,
          maxComparisons: compressConfig?.fuzzyDedupMax ?? 50,
        };
        const deduped = addContentDedup(DEDUP_CACHE, cmd, raw, compressed, fuzzyConfig);

        if (deduped) {
          const strategyLabel = deduped.dedup
            ? (compressed === null ? "fuzzy-dedup" : "dedup")
            : (compressed?.strategy ?? "generic");
          let banner = deduped.dedup
            ? `[Dedup — ${raw.length}→${deduped.output.length} chars (same output seen before)]\n`
            : `[Compressed via ${strategyLabel} — ${raw.length}→${deduped.output.length} chars]\n`;
          let finalOutput = deduped.output;

          const offloadConfig = config.outputOffloading;
          if (offloadConfig?.enabled && !deduped.dedup) {
            const threshold = offloadConfig.thresholdChars ?? 8000;
            if (finalOutput.length > threshold) {
              const offloadPath = path.join(SCRATCH_DIR, `${createHash("sha256").update(finalOutput).digest("hex").slice(0, 16)}.out`);
              const refBanner = offloadOutput(finalOutput);
              if (refBanner) {
                banner = `[Compressed via ${strategyLabel} — ${raw.length}→${finalOutput.length} chars, offloaded]\n`;
                finalOutput = refBanner;
                writeCompressLog({
                  action: "offloaded",
                  strategy: strategyLabel,
                  cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
                  original_chars: raw.length,
                  compressed_chars: finalOutput.length,
                  original_lines: raw.split("\n").length,
                  compressed_lines: 1,
                  reduction_pct: Math.round((1 - finalOutput.length / raw.length) * 100),
                  duration_ms: Math.round(durationMs),
                  failed: failed ? 1 : 0,
                  offload_path: offloadPath,
                  offload_bytes: finalOutput.length,
                  before_snippet: contentSnippet(raw, 120),
                  after_snippet: contentSnippet(finalOutput, 120),
                });
              } else {
                writeCompressLog({
                  action: "offload-failed",
                  strategy: strategyLabel,
                  cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
                  original_chars: raw.length,
                  compressed_chars: finalOutput.length,
                  duration_ms: Math.round(durationMs),
                  failed: failed ? 1 : 0,
                  before_snippet: contentSnippet(raw, 120),
                  after_snippet: contentSnippet(finalOutput, 120),
                });
              }
            } else {
              writeCompressLog({
                action: "offload-skipped-under-threshold",
                strategy: strategyLabel,
                cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
                original_chars: raw.length,
                compressed_chars: finalOutput.length,
                offload_threshold: threshold,
                duration_ms: Math.round(durationMs),
                failed: failed ? 1 : 0,
                before_snippet: contentSnippet(raw, 120),
                after_snippet: contentSnippet(finalOutput, 120),
              });
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
            before_snippet: contentSnippet(raw, 120),
            after_snippet: contentSnippet(deduped.output, 120),
          });
          store.recordCompressionStat({
            sessionId: input.sessionID ?? "unknown",
            command: cmd,
            strategy: strategyLabel,
            originalChars: raw.length,
            compressedChars: deduped.output.length,
            originalLines: raw.split("\n").length,
            compressedLines: deduped.output.split("\n").length,
            cmdPreview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
            originalPreview: contentPreview(raw),
            compressedPreview: contentPreview(deduped.output),
            durationMs,
          }).catch((err) => memLog("error", "compress", "Failed to record compression stat", { error: String(err) }));
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
