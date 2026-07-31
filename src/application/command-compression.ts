import { memLog } from "../logging";
import { DEFAULT_TIERED, type CompressConfig } from "./command-compression/config";
import { compressLs } from "./command-compression/strategies/ls";
import { compressTestOutput } from "./command-compression/strategies/test";
import { compressGrep } from "./command-compression/strategies/grep";
import { compressGitStatus, compressGitLog, compressGitDiff, compressGitPush, compressGitCommit, compressGitAdd } from "./command-compression/strategies/git";
import { compressGeneric, compressRelevantGeneric } from "./command-compression/strategies/generic";
import { applyShapeCompression } from "./command-compression/shape";
import { trimByRelevance } from "./command-compression/relevance";
import { isSignalOutput, stripAnsi, smartFilter, getCommandPrefix, applyWordAbbreviations, estimateTokens } from "./command-compression/utils";

export type { CompressConfig, FuzzyDedupConfig, OllamaExtractionConfig } from "./command-compression/config";
export { tryDeltaCompression, updateDeltaCache } from "./command-compression/delta";
export { addContentDedup } from "./command-compression/dedup";
export { compressGeneric, compressRelevantGeneric, compressLs, compressTestOutput, compressGrep, compressGitStatus, compressGitLog, compressGitDiff, compressGitPush, compressGitCommit, compressGitAdd } from "./command-compression/strategies";
export { ollamaExtract } from "./command-compression/ollama-extract";
export { compressByType, detectOutputType } from "./command-compression/output-types";

const ERROR_MARKERS = /error|panic|traceback|FAILED|failed|exception|fatal/i;

export function compressCommandOutput(
  command: string,
  rawOutput: string,
  failed: boolean,
  config: CompressConfig,
  intentTerms?: string[],
): { output: string; strategy: string } | null {
  if (!config.enabled) return null;
  if (config.alwaysFullOnFailure && failed) return null;

  const cmd = command.trim();
  for (const excl of config.excludeCommands) {
    if (cmd.startsWith(excl)) return null;
  }

  const out = smartFilter(stripAnsi(rawOutput));
  if (!out) return null;
  if (out.length < 80) return null;

  const prefix = getCommandPrefix(cmd);
  if (prefix.length === 0) return null;

  // Payload-preserving commands keep their answer lines even when the output
  // mentions errors (grep keeps matched lines, ls keeps names, git keeps the
  // file list, tests keep failures), so they are exempt from the signal gate.
  // Only lossy strategies (generic/truncate/shape) risk dropping an error.
  const isPayloadPreserving =
    /^(?:rg|grep)\s/.test(prefix) ||
    prefix.startsWith("ls") || prefix.startsWith("tree ") ||
    prefix.startsWith("git ") ||
    /^(npm test|bun test|pnpm test|yarn test|vitest|jest|pytest|go test|cargo test)/.test(prefix);
  if (!isPayloadPreserving && isSignalOutput(out)) return null;

  // ── Tier 0: verbatim pass-through ────────────────────────────────────────
  // Small outputs stay intact: the payload IS the answer. Only genuinely large
  // output is eligible for compression (lines OR a very long single line).
  const verbatimBelowLines = config.verbatimBelowLines ?? DEFAULT_TIERED.verbatimBelowLines;
  const outLines = out.split("\n");
  const isLarge = outLines.length > verbatimBelowLines || out.length > 4000;
  if (!isLarge) return null;

  // ── Net-win gate: skip compression unless savings clear the token bar ────
  const netWin = config.netWinMinTokens ?? DEFAULT_TIERED.netWinMinTokens;
  const accepts = (candidate: string | null): boolean => {
    if (candidate === null || candidate === out) return false;
    if (candidate.length >= out.length) return false;
    return estimateTokens(out) - estimateTokens(candidate) >= netWin;
  };

  // ── Benign-aware threshold: clean output stays verbatim much longer ──────
  const hasErrors = ERROR_MARKERS.test(out);
  const tier3Threshold = hasErrors
    ? (config.errorThreshold ?? DEFAULT_TIERED.errorThreshold)
    : (config.benignThreshold ?? DEFAULT_TIERED.benignThreshold);
  const exceedsTier3 = outLines.length > tier3Threshold || out.length > 12000;

  const keepMatches = config.keepMatches ?? DEFAULT_TIERED.keepMatches;
  const keepNames = config.keepNames ?? DEFAULT_TIERED.keepNames;
  const keepRows = config.keepRows ?? DEFAULT_TIERED.keepRows;

  const cmdFamily = (prefix.split(/\s+/)[0] ?? "").toLowerCase();
  const essentialColumns = config.essentialColumns?.[cmdFamily];

  let result: string | null = null;
  let strategy = "";

  if (prefix.startsWith("ls") || prefix.startsWith("tree ")) {
    result = compressLs(out, keepNames); strategy = "ls";
  } else if (/^(npm test|bun test|pnpm test|yarn test|vitest|jest|pytest|go test|cargo test)/.test(prefix)) {
    result = compressTestOutput(out); strategy = "test";
  } else if (/^(?:rg|grep)\s/.test(prefix)) {
    result = compressGrep(out, keepMatches); strategy = "grep";
  } else if (prefix.startsWith("git status")) {
    result = compressGitStatus(out); strategy = "git-status";
  } else if (prefix.startsWith("git log")) {
    result = compressGitLog(out); strategy = "git-log";
  } else if (prefix.startsWith("git diff")) {
    result = compressGitDiff(out); strategy = "git-diff";
  } else if (/^git push\b/.test(prefix)) {
    result = compressGitPush(out); strategy = "git-quick";
  } else if (/^git commit\b/.test(prefix)) {
    result = compressGitCommit(out); strategy = "git-quick";
  } else if (/^git add\b/.test(prefix)) {
    result = compressGitAdd(out); strategy = "git-quick";
  } else if (/^git pull\b/.test(prefix)) {
    if (/Already up to date|Already up-to-date/i.test(out)) {
      result = "up to date"; strategy = "git-quick";
    } else if (/Fast-forward/i.test(out)) {
      const summary = out.split("\n").filter(l => /^\s+\d+\s+files?\s+changed/i.test(l) || /Fast-forward/i.test(l));
      result = summary.join(" | ") || out.split("\n").slice(0, 3).join("\n");
      strategy = "git-quick";
    } else {
      const clean = out.trim();
      if (clean) result = clean.split("\n").slice(0, 3).join("\n");
      strategy = "git-quick";
    }
  } else if (prefix.startsWith("cat ") || prefix.startsWith("head ") || prefix.startsWith("tail ") || prefix.startsWith("find ") || prefix.startsWith("docker")) {
    if (exceedsTier3) { result = compressGeneric(out, config.maxLines); strategy = "truncate"; }
  } else if (/^(npm run|bun run|pnpm run|yarn)\s/.test(prefix)) {
    if (exceedsTier3) { result = compressGeneric(out, config.maxLines); strategy = "truncate"; }
  }

  if (result !== null && accepts(result)) {
    const abbreviated = applyWordAbbreviations(result);
    memLog("debug", "compress", "Compressed output", {
      cmd: cmd.slice(0, 60),
      originalChars: out.length,
      compressedChars: result.length,
      saving: `${Math.round((1 - result.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: abbreviated, strategy };
  }

  if (exceedsTier3) {
    const shaped = applyShapeCompression(out, config.maxLines, keepRows, essentialColumns);
    if (shaped && accepts(shaped.output)) {
      const abbreviated = applyWordAbbreviations(shaped.output);
      memLog("debug", "compress", "Shape-based compression applied", {
        cmd: cmd.slice(0, 60), shape: shaped.strategy,
        originalChars: out.length, compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: abbreviated, strategy: shaped.strategy };
    }
  }

  if (config.relevanceTrimmingEnabled && outLines.length > 20) {
    const trimmed = trimByRelevance(out, prefix, config, intentTerms);
    if (accepts(trimmed)) {
      const abbreviated = applyWordAbbreviations(trimmed);
      memLog("debug", "compress", "Relevance-trimmed output", {
        cmd: cmd.slice(0, 60),
        originalChars: out.length,
        compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: abbreviated, strategy: "relevance-trim" };
    }
  }

  if (exceedsTier3) {
    const generic = compressRelevantGeneric(out, config.maxLines, cmd);
    if (accepts(generic)) {
      const abbreviated = applyWordAbbreviations(generic);
      memLog("debug", "compress", "Relevant generic compression applied", {
        cmd: cmd.slice(0, 60),
        originalChars: out.length,
        compressedChars: abbreviated.length,
        saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: abbreviated, strategy: "generic" };
    }
  }

  return null;
}
