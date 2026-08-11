import type { OutputTypeResult } from "../types";

export function compressBuildLog(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n");
  const errors: string[] = [];
  const warnings: string[] = [];
  const body: string[] = [];
  let progressCount = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes("█") || t.includes("░") || (t.includes("[") && t.includes("%"))) { progressCount++; continue; }
    const clean = t.replace(/^\[?\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\]?\s*/, "");
    if (/\b(ERROR|error|Error)\b/.test(clean)) errors.push(clean.slice(0, 200));
    else if (/\b(WARN|WARNING|warn|warning)\b/.test(clean)) warnings.push(clean.slice(0, 200));
    else body.push(clean);
  }

  const result: string[] = [];
  if (errors.length > 0) {
    result.push(`errors (${errors.length}):`);
    result.push(...errors.slice(0, 5).map(e => `  ${e}`));
    if (errors.length > 5) result.push(`  ... +${errors.length - 5} more error lines`);
  }
  if (warnings.length > 0) {
    result.push(`warnings (${warnings.length}):`);
    result.push(...warnings.slice(0, 3).map(w => `  ${w}`));
    if (warnings.length > 3) result.push(`  ... +${warnings.length - 3} more warning lines`);
  }

  const keepAfterErrors = 5;
  const bodyToUse = body.length <= keepAfterErrors ? body : [...body.slice(0, 3), `... ${body.length - keepAfterErrors} lines omitted`, ...body.slice(-2)];
  result.push(...bodyToUse);

  if (progressCount > 0) result.unshift(`[progress: ${progressCount} progress lines]`);

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "build-log", compressed };
}
