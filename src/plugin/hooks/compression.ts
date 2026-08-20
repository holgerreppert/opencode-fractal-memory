import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { recordInjection } from "../../application/injection-visibility";
import { memLog } from "../../logging";
import { writeCompressLog } from "../../logging";
import { compressCommandOutput, addContentDedup, tryDeltaCompression, updateDeltaCache, ollamaExtract, enqueueExtraction, pendingExtractionCount, type FuzzyDedupConfig } from "../../application/command-compression";
import { stashOriginal } from "../../application/tool-compression";
import {
  DEDUP_CACHE, DELTA_CACHE, contentSnippet, contentPreview, offloadOutput, offloadPathFor,
  purgeOldScratch, getSessionCache, trySessionCache, recordSessionCache, droppedIdentifiers,
} from "../../application/command-compression/hook-support";
import type { HookHandler } from "./types";

export function createCompressionHandler(store: MemoryStore, config: MemConfig): HookHandler {
  purgeOldScratch().catch(() => { /* empty */ });
  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: { command?: string }; sessionID?: string };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      const compressConfig = config.commandCompression;
      if (!compressConfig?.enabled) {
        memLog("info", "compress", "hook-skip reason=compression-disabled", { tool: input.tool ?? "?" });
        return;
      }
      if (input.tool !== "bash") return;

      const success = !(out.metadata?.error);
      const cmd = input.args?.command ?? "";
      const raw = (out.output ?? "") as string;
      const failed = !success || !!out.metadata?.error;
      const t0 = performance.now();
      const cmdPreview = cmd.replace(/\s+/g, " ").trim().slice(0, 60);
      const trace = (msg: string, extra?: Record<string, unknown>): void => {
        memLog("info", "compress", msg, {
          cmd: cmdPreview,
          chars: raw.length,
          failed: failed ? 1 : 0,
          ...(extra ?? {}),
        });
      };

      trace("hook-enter");

      const deltaResult = tryDeltaCompression(DELTA_CACHE, cmd, raw, compressConfig);
      if (deltaResult) {
        updateDeltaCache(DELTA_CACHE, cmd, raw, deltaResult.strategy, compressConfig?.deltaMaxCacheSize ?? 50);
        const durationMs = performance.now() - t0;
        trace("delta-compressed", { strategy: deltaResult.strategy, compressed_chars: deltaResult.output.length, duration_ms: Math.round(durationMs) });
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

      // Check session-persistent cache before running strategies
      const sessionCache = getSessionCache(input.sessionID ?? "");
      const cached = trySessionCache(sessionCache, raw);
      if (cached) {
        const cacheDurationMs = performance.now() - t0;
        trace("session-cache-hit", { strategy: cached.strategy + "-cached", compressed_chars: cached.output.length, duration_ms: Math.round(cacheDurationMs) });
        out.output = `[Cached — ${raw.length}→${cached.output.length} chars (via session cache)]\n${cached.output}`;
        out.metadata = {
          ...((out.metadata as Record<string, unknown>) ?? {}),
          compressed: true,
          compressStrategy: cached.strategy + "-cached",
        };
        writeCompressLog({
          action: "session-cache-hit",
          strategy: cached.strategy + "-cached",
          cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
          original_chars: raw.length,
          compressed_chars: cached.output.length,
          original_lines: raw.split("\n").length,
          compressed_lines: cached.output.split("\n").length,
          reduction_pct: raw.length > 0 ? Math.round((1 - cached.output.length / raw.length) * 100) : 0,
          duration_ms: Math.round(cacheDurationMs),
          failed: failed ? 1 : 0,
        });
        return;
      }

      // Extract intent terms from command for context-aware relevance trimming
      const cmdTerms = cmd.split(/\s+/).filter(t => !t.startsWith("-") && t.length >= 3).map(t => t.toLowerCase().replace(/["'`()]/g, ""));
      const intentTerms = [...new Set(cmdTerms)];

      let compressed = compressCommandOutput(cmd, raw, failed, compressConfig, intentTerms.length > 0 ? intentTerms : undefined);

      // Try Ollama extraction as last-resort when sync strategies don't match.
      // When deferToIdle is on (default), DON'T block the tool loop on a slow
      // model load — enqueue and let the session.idle drain run it with a long
      // timeout, caching the result so repeat outputs compress instantly.
      if (!compressed && compressConfig?.ollamaExtraction?.enabled) {
        const extConfig = compressConfig.ollamaExtraction;
        if (extConfig.deferToIdle !== false) {
          enqueueExtraction({ sessionId: input.sessionID ?? "unknown", output: raw, command: cmd }, extConfig.maxQueueSize);
          trace("deferred-to-idle", { queue: pendingExtractionCount() });
        } else {
          try {
            const extracted = await ollamaExtract(raw, cmd, extConfig);
            if (extracted) {
              compressed = { output: extracted, strategy: "ollama-extract" };
            }
          } catch {
            // Best-effort — fall through to no compression
          }
        }
      }

      const durationMs = performance.now() - t0;

      if (compressed) {
        updateDeltaCache(DELTA_CACHE, cmd, raw, compressed.strategy, compressConfig?.deltaMaxCacheSize ?? 50);
        recordSessionCache(sessionCache, raw, compressed.output, compressed.strategy);
        trace("compressed", { strategy: compressed.strategy, compressed_chars: compressed.output.length });
      } else {
        // Cache that this output is not compressible (empty marker)
        trace("not-compressible", { strategy: "none" });
        if (raw.length >= 80) {
          recordSessionCache(sessionCache, raw, raw, "no-compression");
        }
      }

      try {
        const fuzzyConfig: FuzzyDedupConfig = {
          enabled: compressConfig?.fuzzyDedupEnabled ?? true,
          similarityThreshold: compressConfig?.fuzzyDedupThreshold ?? 0.85,
          maxComparisons: compressConfig?.fuzzyDedupMax ?? 50,
        };
        const deduped = addContentDedup(DEDUP_CACHE, raw, compressed, fuzzyConfig);

        if (deduped) {
          const strategyLabel = deduped.dedup
            ? (compressed === null ? "fuzzy-dedup" : "dedup")
            : (compressed?.strategy ?? "generic");
          let banner = deduped.dedup
            ? `[Dedup — ${raw.length}→${deduped.output.length} chars (same output seen before)]\n`
            : `[Compressed via ${strategyLabel} — ${raw.length}→${deduped.output.length} chars]\n`;
          let finalOutput = deduped.output;

          // Reversible compression: always stash the original so the model can
          // recover any dropped detail via `cat <path>` (progressive disclosure).
          const reversible = !deduped.dedup;
          let stashPath: string | null = null;
          if (reversible) {
            stashPath = stashOriginal(raw);
          }

          const offloadConfig = config.outputOffloading;
          if (offloadConfig?.enabled && !deduped.dedup) {
            const threshold = offloadConfig.thresholdChars ?? 8000;
            if (finalOutput.length > threshold) {
              const offloadPath = offloadPathFor(finalOutput);
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

          // Identifier factsheet: list hashes/ids that the summary dropped so
          // lossy compression can never silently lose one.
          let idsNote = "";
          if (!deduped.dedup) {
            const dropped = droppedIdentifiers(raw, finalOutput);
            if (dropped.length > 0) {
              idsNote = `\n[ids_preserved: ${dropped.join(", ")}]`;
            }
          }

          const reversibleNote = stashPath ? `\n[Original stashed — use \`cat ${stashPath}\`]` : "";
          out.output = banner + finalOutput + reversibleNote + idsNote;
          out.metadata = {
            ...((out.metadata as Record<string, unknown>) ?? {}),
            compressed: true,
            compressStrategy: strategyLabel,
            deduped: deduped.dedup,
          };
          recordInjection(config, "compression", `${raw.length}→${finalOutput.length} chars via ${strategyLabel}${deduped.dedup ? " (dedup)" : ""}${stashPath ? " + stash" : ""}`);
          trace(deduped.dedup ? "dedup-applied" : "compression-applied", {
            strategy: strategyLabel,
            compressed_chars: deduped.output.length,
            reduction_pct: raw.length > 0 ? Math.round((1 - deduped.output.length / raw.length) * 100) : 0,
            duration_ms: Math.round(durationMs),
            stashed: stashPath ? 1 : 0,
            offloaded: offloadConfig?.enabled && !deduped.dedup && finalOutput.length > (offloadConfig.thresholdChars ?? 8000) ? 1 : 0,
          });
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
          const skipReason = compressed === null ? "no-strategy-matched" : "classification-skipped-signal";
          trace("skip", { reason: skipReason, duration_ms: Math.round(durationMs) });
          writeCompressLog({
            action: "skipped",
            cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
            original_chars: raw.length,
            failed: failed ? 1 : 0,
            duration_ms: Math.round(durationMs),
            reason: skipReason,
          });
        }
      } catch (err) {
        trace("error", { error: String(err).slice(0, 100) });
        writeCompressLog({
          action: "error",
          cmd_preview: cmd.replace(/\s+/g, " ").trim().slice(0, 60),
          error: String(err).slice(0, 100),
        });
      }
    },
  };
}
