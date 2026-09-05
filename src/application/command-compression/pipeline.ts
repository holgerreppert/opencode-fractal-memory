import { memLog } from "../../logging";
import { DEFAULT_TIERED, DEFAULT_PER_TOOL, type CompressConfig } from "./config";
import { createStrategyRegistry, type StrategyContext } from "./strategy";
import { compressRelevantGeneric } from "./strategies/generic";
import { applyShapeCompression } from "./shape";
import { trimByRelevance } from "./relevance";
import { compressErrorFirst } from "./strategies/error";
import { compressByType } from "./output-types";
import { isSignalOutput, stripAnsi, smartFilter, getCommandPrefix, applyWordAbbreviations, estimateTokens } from "./utils";

const ERROR_MARKERS = /error|panic|traceback|FAILED|failed|exception|fatal/i;

function compressTrace(cmd: string, msg: string, extra?: Record<string, unknown>): void {
  memLog("info", "compress", msg, { cmd: cmd.replace(/\s+/g, " ").trim().slice(0, 60), ...(extra ?? {}) });
}

/**
 * Decide whether a command is payload-preserving: its answer lines are kept
 * even when the output mentions errors (grep keeps matched lines, ls keeps
 * names, git keeps the file list, tests keep failures), so they are exempt
 * from the signal gate. Only lossy strategies (generic/truncate/shape) risk
 * dropping an error.
 */
function isPayloadPreserving(prefix: string): boolean {
  return (
    /^(?:rg|grep)\s/.test(prefix) ||
    prefix.startsWith("ls") || prefix.startsWith("tree ") ||
    prefix.startsWith("git ") ||
    /^(npm test|bun test|pnpm test|yarn test|vitest|jest|pytest|go test|cargo test)/.test(prefix)
  );
}

export function compressCommandOutput(
  command: string,
  rawOutput: string,
  failed: boolean,
  config: CompressConfig,
  intentTerms?: string[],
): { output: string; strategy: string } | null {
  const cmd = command.trim();
  const logSkip = (reason: string, extra?: Record<string, unknown>): null => {
    compressTrace(cmd, `skip reason=${reason}`, {
      chars: rawOutput.length,
      failed: failed ? 1 : 0,
      ...(extra ?? {}),
    });
    return null;
  };

  if (!config.enabled) return logSkip("disabled");
  if (config.alwaysFullOnFailure && failed) return logSkip("always-full-on-failure");

  for (const excl of config.excludeCommands) {
    if (cmd.startsWith(excl)) return logSkip("exclude-command", { exclude: excl });
  }

  const out = smartFilter(stripAnsi(rawOutput));
  if (!out) return logSkip("empty-after-filter", { chars: rawOutput.length });
  if (out.length < 80) return logSkip("too-short", { filtered_chars: out.length });

  const prefix = getCommandPrefix(cmd);
  if (prefix.length === 0) return logSkip("no-command-prefix");

  if (!isPayloadPreserving(prefix) && isSignalOutput(out)) return logSkip("signal-output", { chars: out.length });

  // ── Tier 0: verbatim pass-through ────────────────────────────────────────
  // Small outputs stay intact: the payload IS the answer. Only genuinely large
  // output is eligible for compression (lines OR a very long single line).
  const verbatimBelowLines = config.verbatimBelowLines ?? DEFAULT_TIERED.verbatimBelowLines;
  const outLines = out.split("\n");
  const isLarge = outLines.length > verbatimBelowLines || out.length > 4000;
  if (!isLarge) return logSkip("below-verbatim-threshold", { lines: outLines.length, chars: out.length });

  // ── Net-win gate: skip compression unless savings clear the token bar ────
  const netWin = config.netWinMinTokens ?? DEFAULT_TIERED.netWinMinTokens;
  const accepts = (candidate: string | null): boolean => {
    if (candidate === null || candidate === out) return false;
    if (candidate.trim().length === 0) return false;
    if (candidate.length >= out.length) return false;
    return estimateTokens(out) - estimateTokens(candidate) >= netWin;
  };

  const keepMatches = config.keepMatches ?? DEFAULT_TIERED.keepMatches;
  const keepNames = config.keepNames ?? DEFAULT_TIERED.keepNames;
  const keepRows = config.keepRows ?? DEFAULT_TIERED.keepRows;

  const cmdFamily = (prefix.split(/\s+/)[0] ?? "").toLowerCase();
  const essentialColumns = config.essentialColumns?.[cmdFamily];

  // ── Per-tool + error-first fast path (failing outputs) ─────────────────
  const perTool = (() => {
    const pt = config.perTool ?? DEFAULT_PER_TOOL;
    // longest prefix match (e.g., "bun test" beats "bun")
    let best: { key: string; val: typeof pt[string] } | null = null;
    for (const [k, v] of Object.entries(pt)) {
      if (cmd.startsWith(k) || prefix.startsWith(k)) {
        if (!best || k.length > best.key.length) best = { key: k, val: v };
      }
    }
    return best?.val ?? null;
  })();
  const effectiveErrorThreshold = perTool?.errorThreshold ?? (config.errorThreshold ?? DEFAULT_TIERED.errorThreshold);
  const effectiveMaxTokens = perTool?.maxTokens;
  // ── Benign-aware threshold: clean output stays verbatim much longer ──────
  const hasErrors = ERROR_MARKERS.test(out);
  const tier3Threshold = hasErrors
    ? effectiveErrorThreshold
    : (config.benignThreshold ?? DEFAULT_TIERED.benignThreshold);
  const exceedsTier3 = outLines.length > tier3Threshold || out.length > 12000;
  // If failing or error-marked, try error-first projection before generic shape
  const shouldTryErrorFirst = (failed || ERROR_MARKERS.test(out)) && (perTool?.strategy === "error-first" || /test|pytest|jest|vitest|cargo|go test/.test(prefix));
  if (shouldTryErrorFirst) {
    const err = compressErrorFirst(out, effectiveMaxTokens ?? 2500);
    if (accepts(err)) {
      const abbreviated = applyWordAbbreviations(err);
      compressTrace(cmd, `compressed strategy=error-first`, {
        originalChars: out.length,
        compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
        perTool: perTool ? 1 : 0,
      });
      return { output: abbreviated, strategy: "error-first" };
    }
    compressTrace(cmd, `error-first-rejected-net-win`, { candidateChars: err.length, originalChars: out.length });
  }

  // ── Content-type router (before registry) — JSON/logs/tabular/coverage/npm ─
  // Skip for payload-preserving commands where registry (ls/grep/test/git) is more precise
  let typed: ReturnType<typeof compressByType> = null;
  if (!isPayloadPreserving(prefix)) {
    typed = compressByType(out, config.maxLines ?? 50);
  }
  if (typed && typed.type !== "raw-text" && typed.compressed.length < out.length) {
    // compressByType already is type-aware (compiler-diagnostics/test-output/npm-install/coverage)
    // Use net-win gate like other strategies
    if (accepts(typed.compressed)) {
      const abbreviated = applyWordAbbreviations(typed.compressed);
      compressTrace(cmd, `compressed strategy=typed:${typed.type}`, {
        originalChars: out.length,
        compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: abbreviated, strategy: `typed:${typed.type}` };
    }
    compressTrace(cmd, `typed-rejected-net-win type=${typed.type}`, { candidateChars: typed.compressed.length, originalChars: out.length });
  }

  // Respect per-tool errorThreshold for benign vs error gate
  // (recomputed verbatim below but we already have hasErrors)

  // ── Strategy dispatch: first matching registry entry wins ────────────────
  const ctx: StrategyContext = {
    cmd,
    raw: out,
    lines: outLines,
    config: { ...config, errorThreshold: effectiveErrorThreshold } as CompressConfig,
    keepMatches,
    keepNames,
    keepRows,
    exceedsTier3,
    essentialColumns,
  };

  let result: string | null = null;
  let strategy = "";
  const registry = createStrategyRegistry();
  for (const entry of registry) {
    if (entry.matches(prefix, ctx)) {
      result = entry.compress(ctx);
      strategy = entry.id;
      break;
    }
  }

  if (strategy) {
    compressTrace(cmd, `strategy-ran strategy=${strategy}`, {
      produced: result !== null ? result.length : 0,
      from: out.length,
      lines: outLines.length,
      exceedsTier3: exceedsTier3 ? 1 : 0,
    });
  }

  if (result !== null && accepts(result)) {
    const abbreviated = applyWordAbbreviations(result);
    compressTrace(cmd, `compressed strategy=${strategy}`, {
      originalChars: out.length,
      compressedChars: abbreviated.length,
      saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: abbreviated, strategy };
  }
  if (result !== null && !accepts(result)) {
    compressTrace(cmd, `strategy-rejected-net-win strategy=${strategy}`, {
      candidateChars: result.length,
      originalChars: out.length,
    });
  }

  if (exceedsTier3) {
    const shaped = applyShapeCompression(out, config.maxLines, keepRows, essentialColumns);
    compressTrace(cmd, `shape-ran strategy=${shaped?.strategy ?? "none"}`, {
      produced: shaped ? shaped.output.length : 0,
      accepted: shaped ? accepts(shaped.output) ? 1 : 0 : 0,
    });
    if (shaped && accepts(shaped.output)) {
      const abbreviated = applyWordAbbreviations(shaped.output);
      compressTrace(cmd, `compressed strategy=shape:${shaped.strategy}`, {
        originalChars: out.length,
        compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: abbreviated, strategy: shaped.strategy };
    }
  }

  if (config.relevanceTrimmingEnabled && outLines.length > 20) {
    const trimmed = trimByRelevance(out, prefix, config, intentTerms);
    compressTrace(cmd, `relevance-ran`, {
      produced: trimmed.length,
      accepted: accepts(trimmed) ? 1 : 0,
    });
    if (accepts(trimmed)) {
      const abbreviated = applyWordAbbreviations(trimmed);
      compressTrace(cmd, `compressed strategy=relevance-trim`, {
        originalChars: out.length,
        compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: abbreviated, strategy: "relevance-trim" };
    }
  }

  if (exceedsTier3) {
    const generic = compressRelevantGeneric(out, config.maxLines, cmd);
    compressTrace(cmd, `generic-ran`, {
      produced: generic.length,
      accepted: accepts(generic) ? 1 : 0,
    });
    if (accepts(generic)) {
      const abbreviated = applyWordAbbreviations(generic);
      compressTrace(cmd, `compressed strategy=generic`, {
        originalChars: out.length,
        compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: abbreviated, strategy: "generic" };
    }
  }

  compressTrace(cmd, "skip reason=no-strategy-accepted", {
    chars: out.length,
    lines: outLines.length,
    exceedsTier3: exceedsTier3 ? 1 : 0,
    relevanceEnabled: config.relevanceTrimmingEnabled ? 1 : 0,
  });
  return null;
}
