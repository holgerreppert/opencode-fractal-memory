import { memLog } from "../logging";
import type { CompressConfig } from "./command-compression/config";
import { compressLs } from "./command-compression/strategies/ls";
import { compressTestOutput } from "./command-compression/strategies/test";
import { compressGrep } from "./command-compression/strategies/grep";
import { compressGitStatus, compressGitLog, compressGitDiff } from "./command-compression/strategies/git";
import { compressGeneric, compressRelevantGeneric } from "./command-compression/strategies/generic";
import { applyShapeCompression } from "./command-compression/shape";
import { trimByRelevance } from "./command-compression/relevance";
import { isSignalOutput, stripAnsi, smartFilter, getCommandPrefix } from "./command-compression/utils";

export type { CompressConfig, FuzzyDedupConfig } from "./command-compression/config";
export { tryDeltaCompression, updateDeltaCache } from "./command-compression/delta";
export { addContentDedup } from "./command-compression/dedup";
export { compressGeneric, compressRelevantGeneric, compressLs, compressTestOutput, compressGrep, compressGitStatus, compressGitLog, compressGitDiff } from "./command-compression/strategies";

export function compressCommandOutput(
  command: string,
  rawOutput: string,
  failed: boolean,
  config: CompressConfig
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

  if (isSignalOutput(out)) return null;

  const prefix = getCommandPrefix(cmd);
  if (prefix.length === 0) return null;

  let result: string | null = null;
  let strategy = "";

  if (prefix.startsWith("ls") || prefix.startsWith("tree ")) {
    if (out.split("\n").length > 5) {
      result = compressLs(out); strategy = "ls";
    }
  } else if (/^(npm test|bun test|pnpm test|yarn test|vitest|jest|pytest|go test|cargo test)/.test(prefix)) {
    result = compressTestOutput(out); strategy = "test";
  } else if (/^(?:rg|grep)\s/.test(prefix)) {
    result = compressGrep(out); strategy = "grep";
  } else if (prefix.startsWith("git status")) {
    result = compressGitStatus(out); strategy = "git-status";
  } else if (prefix.startsWith("git log")) {
    result = compressGitLog(out); strategy = "git-log";
  } else if (prefix.startsWith("git diff")) {
    result = compressGitDiff(out); strategy = "git-diff";
  } else if (/^git (push|pull|commit|add)\b/.test(prefix)) {
    const clean = out.trim();
    if (clean) result = clean.split("\n").slice(0, 3).join("\n");
    strategy = "git-quick";
  } else if (prefix.startsWith("cat ") || prefix.startsWith("head ")) {
    result = compressGeneric(out, config.maxLines); strategy = "truncate";
  } else if (/^(npm run|bun run|pnpm run|yarn)\s/.test(prefix)) {
    result = compressGeneric(out, config.maxLines); strategy = "truncate";
  } else if (prefix.startsWith("docker")) {
    result = compressGeneric(out, config.maxLines); strategy = "truncate";
  } else if (prefix.startsWith("find ")) {
    result = compressGeneric(out, config.maxLines); strategy = "truncate";
  } else if (prefix.startsWith("tail ")) {
    result = compressGeneric(out, config.maxLines); strategy = "truncate";
  }

  if (result !== null && result !== out && result.length < out.length) {
    memLog("debug", "compress", "Compressed output", {
      cmd: cmd.slice(0, 60),
      originalChars: out.length,
      compressedChars: result.length,
      saving: `${Math.round((1 - result.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: result, strategy };
  }

  const shaped = applyShapeCompression(out, config.maxLines);
  if (shaped) {
    memLog("debug", "compress", "Shape-based compression applied", {
      cmd: cmd.slice(0, 60), shape: shaped.strategy,
      originalChars: out.length, compressedChars: shaped.output.length,
      saving: `${Math.round((1 - shaped.output.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return shaped;
  }

  if (config.relevanceTrimmingEnabled && out.split("\n").length > 20) {
    const trimmed = trimByRelevance(out, prefix, config);
    if (trimmed !== out) {
      memLog("debug", "compress", "Relevance-trimmed output", {
        cmd: cmd.slice(0, 60),
        originalChars: out.length,
        compressedChars: trimmed.length,
        saving: `${Math.round((1 - trimmed.length / Math.max(out.length, 1)) * 100)}%`,
      });
      return { output: trimmed, strategy: "relevance-trim" };
    }
  }

  const generic = compressRelevantGeneric(out, config.maxLines, cmd);
  if (generic !== out) {
    memLog("debug", "compress", "Relevant generic compression applied", {
      cmd: cmd.slice(0, 60),
      originalChars: out.length,
      compressedChars: generic.length,
      saving: `${Math.round((1 - generic.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: generic, strategy: "generic" };
  }

  return null;
}
