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

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export function contentPreview(text: string, maxLen = 80): string {
  if (!text) return "";
  const first = text.split("\n").find(l => l.trim());
  return first ? first.trim().slice(0, maxLen) : "";
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const codeChars = "{}()[];=<>+*&|!?:,.\\/\"'-\t\r\n";
  const codeLike = [...text].some(c => codeChars.includes(c));
  return Math.max(1, Math.ceil(codeLike ? text.length / 3.2 : text.length / 4.5));
}

export function getCommandPrefix(rawCmd: string): string {
  const cmd = rawCmd.trim();
  const firstPipe = cmd.indexOf("|");
  const firstSegment = firstPipe >= 0 ? cmd.slice(0, firstPipe) : cmd;

  const envPrefix = /^(?:source\s+\S+\s+(?:&&|;)\s*)*(?:cd\s+\S+\s+(?:&&|;)\s*)*(?:source\s+\S+\s+(?:&&|;)\s*)*/;
  return firstSegment.replace(envPrefix, "").trim();
}

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

/**
 * Smart Filter Pre-Pass — strips low-value noise lines before strategy
 * matching. Patterns sourced from squeez's smart_filter.rs (MIT).
 */
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
