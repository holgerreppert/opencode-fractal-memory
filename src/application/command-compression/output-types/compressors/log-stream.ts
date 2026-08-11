import type { OutputTypeResult } from "../types";

export function compressLogStream(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const bySeverity: Record<string, string[]> = { ERROR: [], WARN: [], WARNING: [], INFO: [], DEBUG: [], TRACE: [], unknown: [] };

  for (const line of lines) {
    const upper = line.toUpperCase();
    let matched = false;
    for (const [pattern, key] of [[/\bERROR\b/, "ERROR"], [/\bWARNING\b|\bWARN\b/, "WARN"], [/\bINFO\b/, "INFO"], [/\bDEBUG\b/, "DEBUG"], [/\bTRACE\b/, "TRACE"]] as const) {
      if (pattern.test(upper)) { bySeverity[key]!.push(line); matched = true; break; }
    }
    if (!matched) bySeverity["unknown"]!.push(line);
  }

  const result: string[] = [];
  for (const sev of ["ERROR", "WARN", "INFO", "DEBUG", "TRACE", "unknown"]) {
    if (!bySeverity[sev] || bySeverity[sev]!.length === 0) continue;
    const count = bySeverity[sev]!.length;
    result.push(`${sev} (${count}):`);
    if (sev === "ERROR" || sev === "WARN") {
      result.push(...bySeverity[sev]!.slice(0, 3).map(l => `  ${l.slice(0, 200)}`));
      if (count > 3) result.push(`  ... +${count - 3} more`);
    }
  }

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "log-stream", compressed };
}
