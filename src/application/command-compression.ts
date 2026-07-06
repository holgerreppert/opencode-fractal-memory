import { memLog } from "../logging";
import type { CompressConfig } from "./command-compression/config";
import { compressLs } from "./command-compression/strategies/ls";
import { compressTestOutput } from "./command-compression/strategies/test";
import { compressGrep } from "./command-compression/strategies/grep";
import { compressGitStatus, compressGitLog, compressGitDiff, compressGitPush, compressGitCommit, compressGitAdd } from "./command-compression/strategies/git";
import { compressGeneric, compressRelevantGeneric } from "./command-compression/strategies/generic";
import { applyShapeCompression } from "./command-compression/shape";
import { trimByRelevance } from "./command-compression/relevance";
import { isSignalOutput, stripAnsi, smartFilter, getCommandPrefix, applyWordAbbreviations } from "./command-compression/utils";

export type { CompressConfig, FuzzyDedupConfig, OllamaExtractionConfig } from "./command-compression/config";
export { tryDeltaCompression, updateDeltaCache } from "./command-compression/delta";
export { addContentDedup } from "./command-compression/dedup";
export { compressGeneric, compressRelevantGeneric, compressLs, compressTestOutput, compressGrep, compressGitStatus, compressGitLog, compressGitDiff, compressGitPush, compressGitCommit, compressGitAdd } from "./command-compression/strategies";
export { ollamaExtract } from "./command-compression/ollama-extract";

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
  } else if (/^git push\b/.test(prefix)) {
    result = compressGitPush(out); strategy = "git-quick";
  } else if (/^git commit\b/.test(prefix)) {
    result = compressGitCommit(out); strategy = "git-quick";
  } else if (/^git add\b/.test(prefix)) {
    result = compressGitAdd(out); strategy = "git-quick";
  } else if (/^git pull\b/.test(prefix)) {
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
    const abbreviated = applyWordAbbreviations(result);
    memLog("debug", "compress", "Compressed output", {
      cmd: cmd.slice(0, 60),
      originalChars: out.length,
      compressedChars: result.length,
      saving: `${Math.round((1 - result.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: abbreviated, strategy };
  }

  const shaped = applyShapeCompression(out, config.maxLines);
  if (shaped) {
    const abbreviated = applyWordAbbreviations(shaped.output);
    memLog("debug", "compress", "Shape-based compression applied", {
      cmd: cmd.slice(0, 60), shape: shaped.strategy,
      originalChars: out.length, compressedChars: abbreviated.length,
      saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: abbreviated, strategy: shaped.strategy };
  }

  if (config.relevanceTrimmingEnabled && out.split("\n").length > 20) {
    const trimmed = trimByRelevance(out, prefix, config, intentTerms);
    if (trimmed !== out) {
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

  const generic = compressRelevantGeneric(out, config.maxLines, cmd);
  if (generic !== out) {
    const abbreviated = applyWordAbbreviations(generic);
    memLog("debug", "compress", "Relevant generic compression applied", {
      cmd: cmd.slice(0, 60),
      originalChars: out.length,
      compressedChars: abbreviated.length,
      saving: `${Math.round((1 - abbreviated.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: abbreviated, strategy: "generic" };
  }

  return null;
}
