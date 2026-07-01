import { memLog } from "../../logging";

export const SIGNAL_PATTERNS = [
  /error/i, /exception/i, /traceback/i, /at\s+\S+\.\S+\(/,
  /FAIL/i, /AssertionError/i, /TypeError/i, /SyntaxError/i,
  /not found/i, /Cannot find/i, /ENOENT/i, /EACCES/i,
  /segmentation fault/i, /signal\s+\d+/i, /killed/i,
  /exit code \d+/i,
];

export function isSignalOutput(raw: string): boolean {
  for (const p of SIGNAL_PATTERNS) {
    if (p.test(raw)) return true;
  }
  return false;
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export function contentPreview(text: string, maxLen = 80): string {
  if (!text) return "";
  const first = text.split("\n").find(l => l.trim());
  return first ? first.trim().slice(0, maxLen) : "";
}

export function getCommandPrefix(rawCmd: string): string {
  const cmd = rawCmd.trim();
  const firstPipe = cmd.indexOf("|");
  const firstSegment = firstPipe >= 0 ? cmd.slice(0, firstPipe) : cmd;

  const envPrefix = /^(?:source\s+\S+\s+(?:&&|;)\s*)*(?:cd\s+\S+\s+(?:&&|;)\s*)*(?:source\s+\S+\s+(?:&&|;)\s*)*/;
  return firstSegment.replace(envPrefix, "").trim();
}

// ── Smart Filter Pre-Pass ─────────────────────────────────────────────────
// Strips low-value noise lines before strategy matching.
// Patterns sourced from squeez's smart_filter.rs (MIT).

const SPINNER_CHARS = new Set(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);

const NOISE_PREFIXES = [
  "npm warn deprecated",
  "npm warn EBADENGINE",
  "npm notice",
  "WARN deprecated",
  "(node:",
  "hint:",
  "[tsconfig-paths]",
  "The plugin \"vite-tsconfig-paths\"",
  "The plugin \"@vitejs/plugin-react\"",
  "Vite now supports tsconfig paths resolution natively",
  "You can remove the plugin and set resolve.tsconfigPaths",
  "For new projects, use create-next-app to choose",
  "`next lint` is deprecated",
  "ExperimentalWarning:",
  "[DEP",
];

function isProgressBar(s: string): boolean {
  const t = s.trim();
  if (t.includes("█") || t.includes("░")) return true;
  if (t.includes("[") && t.includes("]") && t.includes("=") && t.includes(">")) return true;
  if (t.endsWith("%") && [...t].some(c => c >= "0" && c <= "9")) return true;
  return false;
}

function isSpinner(s: string): boolean {
  return SPINNER_CHARS.has(s.trimStart().charAt(0));
}

function isNodeModulesFrame(s: string): boolean {
  return s.includes("node_modules/") && (s.trimStart().startsWith("at ") || s.includes("(/."));
}

function stripLogTimestamp(s: string): string {
  const t = s.trimStart();
  if (t.startsWith("[") || t.startsWith("[")) {
    const end = t.indexOf("] ");
    if (end > 0 && end < 30) {
      const prefix = t.slice(1, end);
      if (prefix.includes("-") && (prefix.includes("T") || prefix.includes(":"))) {
        return t.slice(end + 2);
      }
    }
  }
  return s;
}

export function smartFilter(output: string): string {
  const lines = output.split("\n");
  const result: string[] = [];
  let hasChanges = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed) { result.push(line); continue; }
    if (isSpinner(trimmed)) { hasChanges = true; continue; }
    if (isProgressBar(trimmed)) { hasChanges = true; continue; }
    if (isNodeModulesFrame(trimmed)) { hasChanges = true; continue; }
    let skip = false;
    for (const p of NOISE_PREFIXES) {
      if (trimmed.startsWith(p)) { skip = true; break; }
    }
    if (skip) { hasChanges = true; continue; }
    const cleaned = stripLogTimestamp(line);
    if (cleaned !== line) hasChanges = true;
    result.push(cleaned);
  }
  if (!hasChanges) return output;
  return result.join("\n");
}

// ── Signal Words for Relevance Scoring ────────────────────────────────────
// Used by relevance trimming and relevant generic truncation.

export const SIGNAL_WORDS = [
  "error", "fail", "panic", "exception", "fatal", "traceback",
  "denied", "refused", "timeout", "cannot", "unable", "undefined",
  "unexpected", "warn", "abort", "missing", "not found", "stack",
];

export function extractQueryTerms(cmd: string): string[] {
  const terms: string[] = [];
  const parts = cmd.split(/\s+/);
  for (let i = 1; i < parts.length; i++) {
    const t = parts[i]!;
    if (t.startsWith("-")) continue;
    const cleaned = t.replace(/["'`()]/g, "").toLowerCase();
    if (cleaned.length >= 3) terms.push(cleaned);
  }
  return terms;
}

export function scoreLine(line: string, terms: string[], idx: number, total: number): number {
  const lower = line.toLowerCase();
  let score = 0;
  for (const w of SIGNAL_WORDS) {
    if (lower.includes(w)) score += 5;
  }
  for (const t of terms) {
    if (lower.includes(t)) score += 3;
  }
  if (idx < 3) score += 4 - idx;
  if (idx + 3 >= total) score += 1;
  if (line.trim().length === 0) score -= 1;
  return score;
}
