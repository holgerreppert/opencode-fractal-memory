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
