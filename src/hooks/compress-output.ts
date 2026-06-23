import { createHash } from "node:crypto";
import { memLog } from "../logging";

export interface CompressConfig {
  enabled: boolean;
  maxLines: number;
  excludeCommands: string[];
  alwaysFullOnFailure: boolean;
}

const SIGNAL_PATTERNS = [
  /error/i, /exception/i, /traceback/i, /at\s+\S+\.\S+\(/,
  /FAIL/i, /AssertionError/i, /TypeError/i, /SyntaxError/i,
  /not found/i, /Cannot find/i, /ENOENT/i, /EACCES/i,
  /segmentation fault/i, /signal\s+\d+/i, /killed/i,
  /exit code \d+/i,
];

function isSignalOutput(raw: string): boolean {
  for (const p of SIGNAL_PATTERNS) {
    if (p.test(raw)) return true;
  }
  return false;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

function compressLs(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return raw;

  const total = lines.length;
  const dirs: string[] = [];
  const files: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/^total \d+/, "").trim();
    if (!cleaned) continue;
    if (cleaned.endsWith("/")) {
      const name = cleaned.replace(/\/$/, "").replace(/.*\s+/, "");
      dirs.push(name);
    } else {
      const name = cleaned.replace(/.*\s+/, "");
      files.push(name);
    }
  }

  const parts: string[] = [];
  if (dirs.length > 0) parts.push(`${dirs.length} dir${dirs.length !== 1 ? "s" : ""}`);
  if (files.length > 0) parts.push(`${files.length} file${files.length !== 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(", ") : raw;
}

function compressTestOutput(raw: string): string {
  const lines = raw.split("\n");
  const fails: string[] = [];
  let passed = 0;
  let failed = 0;
  let total = 0;

  const passRe = /^(ok|PASS|\.|✓|√)\s*/;
  const failRe = /^(FAIL|FAILED|not ok|✗|×)\s*/;
  const summaryRe = /(\d+)\s+(test|tests?|passed|failed|run)/i;

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    if (failRe.test(clean) || clean.includes("FAILED") || clean.includes("FAIL ")) {
      failed++;
      fails.push(clean.replace(failRe, "").trim());
    } else if (passRe.test(clean)) {
      passed++;
    }

    const m = summaryRe.exec(clean);
    if (m) total = Math.max(total, parseInt(m[1] ?? "0", 10));
  }

  if (failed === 0 && passed === 0 && total === 0) return raw;

  if (failed > 0) {
    return `${failed} test${failed !== 1 ? "s" : ""} failed:\n${fails.slice(0, 10).map(f => `  FAIL: ${f}`).join("\n")}${fails.length > 10 ? `\n  ... +${fails.length - 10} more` : ""}`;
  }

  return total > 0 ? `${total - failed}/${total} passed` : `${passed} passed`;
}

function compressGrep(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length <= 3) return raw;

  const fileCounts = new Map<string, number>();
  const fileRe = /^(.+?):/;

  for (const line of lines) {
    const m = fileRe.exec(line);
    if (m) {
      const f = (m[1] ?? "").trim();
      if (f) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    }
  }

  if (fileCounts.size === 0) return raw;

  const total = lines.length;
  const entries = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);

  const result: string[] = [`${total} matches across ${fileCounts.size} files:`];
  for (const [file, count] of entries.slice(0, 15)) {
    result.push(`  ${file}: ${count} match${count !== 1 ? "es" : ""}`);
  }
  if (entries.length > 15) result.push(`  ... +${entries.length - 15} more files`);
  return result.join("\n");
}

function compressGitStatus(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return raw;

  const branch = lines.find(l => l.startsWith("On branch ") || l.startsWith("HEAD detached at "));
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("Changes to be committed:")) continue;
    if (s.startsWith("Changes not staged for commit:")) continue;
    if (s.startsWith("Untracked files:")) continue;
    if (s.startsWith("  (use")) continue;
    if (s.startsWith("no changes")) break;
    if (s.startsWith("\t") || s.startsWith("  ")) {
      const clean = s.replace(/^(modified|new file|deleted|renamed):\s*/i, "").trim();
      if (clean && !clean.startsWith("(")) {
        if (staged.length < 5) staged.push(clean);
      }
    }
  }

  if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
    const m = lines.find(l => /nothing to commit|up to date/i.test(l));
    if (m) return "clean";
  }

  const parts: string[] = [];
  if (branch) parts.push(branch.trim());
  if (staged.length > 0) parts.push(`${staged.length} staged`);
  if (unstaged.length > 0) parts.push(`${unstaged.length} unstaged`);
  if (untracked.length > 0) parts.push(`${untracked.length} untracked`);

  return parts.length > 0 ? parts.join(" | ") : raw;
}

function compressGitLog(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("commit ")) {
      const sha = trimmed.slice(7, 14);
      let msg = "";
      for (let j = i + 1; j < lines.length; j++) {
        const cl = lines[j] ?? "";
        const trimmedCl = cl.trim();
        if (trimmedCl.startsWith("commit ") || !trimmedCl) break;
        if (cl.startsWith("    ")) msg = trimmedCl;
      }
      result.push(`${sha} ${msg}`);
    }
  }
  return result.length > 0 ? result.join("\n") : raw;
}

function compressGitDiff(raw: string): string {
  const lines = raw.split("\n");
  const changed: string[] = [];
  const diffs: string[] = [];
  let added = 0;
  let removed = 0;
  let insideHunk = false;
  let lineCount = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git a/")) {
      const name = line.replace(/^diff --git a\//, "").replace(/\s+b\/.*/, "");
      changed.push(name);
      insideHunk = false;
    } else if (line.startsWith("index ") || line.startsWith("similarity index ") || line.startsWith("new file ") || line.startsWith("deleted file ")) {
      continue;
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    } else if (line.startsWith("@@")) {
      insideHunk = true;
      lineCount = 0;
    } else if (insideHunk && line.startsWith("+") && !line.startsWith("+++")) {
      added++;
      lineCount++;
      if (lineCount <= 20) diffs.push(line);
      else if (lineCount === 21) diffs.push("  ...");
    } else if (insideHunk && line.startsWith("-") && !line.startsWith("---")) {
      removed++;
      lineCount++;
      if (lineCount <= 20) diffs.push(line);
      else if (lineCount === 21) diffs.push("  ...");
    } else if (insideHunk && line.startsWith(" ")) {
      lineCount++;
      if (lineCount <= 3) diffs.push(line);
      else if (lineCount === 4) diffs.push(`  ... (${changed.length > 0 ? (changed[changed.length - 1]!.split("/").pop() ?? "") : ""} unchanged context)`);
    }
  }

  const parts: string[] = [`${changed.length} file${changed.length !== 1 ? "s" : ""} changed, +${added} -${removed}`];
  parts.push(...diffs);
  return parts.join("\n");
}

function compressGeneric(raw: string, maxLines: number): string {
  const lines = raw.split("\n");
  const deduped: string[] = [];
  let dupCount = 1;
  for (let i = 0; i < lines.length; i++) {
    const prev = i > 0 ? lines[i - 1] : null;
    if (prev !== null && lines[i] === prev) {
      dupCount++;
      continue;
    }
    if (dupCount > 1 && deduped.length > 0) {
      deduped[deduped.length - 1] += ` (×${dupCount})`;
      dupCount = 1;
    }
    deduped.push(lines[i] ?? "");
  }
  if (dupCount > 1 && deduped.length > 0) {
    deduped[deduped.length - 1] += ` (×${dupCount})`;
  }

  if (deduped.length <= maxLines) return deduped.join("\n");
  const remaining = deduped.length - maxLines;
  const mid = Math.floor(maxLines / 2);
  const head = deduped.slice(0, mid);
  const tail = deduped.slice(-mid);
  head.push(`... truncated: ${remaining} lines omitted, showing head + tail ...`);
  head.push(...tail);
  return head.join("\n");
}

function getCommandPrefix(rawCmd: string): string {
  const cmd = rawCmd.trim();
  const firstPipe = cmd.indexOf("|");
  const firstSegment = firstPipe >= 0 ? cmd.slice(0, firstPipe) : cmd;

  const envPrefix = /^(?:source\s+\S+\s+(?:&&|;)\s*)*(?:cd\s+\S+\s+(?:&&|;)\s*)*(?:source\s+\S+\s+(?:&&|;)\s*)*/;
  return firstSegment.replace(envPrefix, "").trim();
}

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

  const out = stripAnsi(rawOutput);
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

  if (result !== null && result !== out) {
    memLog("debug", "compress", "Compressed output", {
      cmd: cmd.slice(0, 60),
      originalChars: out.length,
      compressedChars: result.length,
      saving: `${Math.round((1 - result.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: result, strategy };
  }

  const generic = compressGeneric(out, config.maxLines);
  if (generic !== out) {
    memLog("debug", "compress", "Generic compression applied", {
      cmd: cmd.slice(0, 60),
      originalChars: out.length,
      compressedChars: generic.length,
      saving: `${Math.round((1 - generic.length / Math.max(out.length, 1)) * 100)}%`,
    });
    return { output: generic, strategy: "generic" };
  }

  return null;
}

export function addContentDedup(
  store: Map<string, { output: string; strategy: string }>,
  command: string,
  rawOutput: string,
  result: { output: string; strategy: string } | null,
): { output: string; strategy: string; dedup: boolean } | null {
  if (!rawOutput || rawOutput.length < 80) return null;

  const hash = createHash("sha256").update(rawOutput).digest("hex").slice(0, 16);

  const existing = store.get(hash);
  if (existing) {
    return { output: `§ref:${hash}§ (${existing.output.split("\n")[0]})`, strategy: "dedup", dedup: true };
  }

  if (result) {
    store.set(hash, { output: result.output, strategy: result.strategy });
  }

  return result ? { ...result, dedup: false } : null;
}
