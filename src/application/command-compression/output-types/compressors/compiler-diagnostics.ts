import type { OutputTypeResult } from "../types";

export function compressCompilerDiagnostics(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const byFile = new Map<string, { errors: string[]; warnings: string[]; notes: string[] }>();

  for (const line of lines) {
    const t = line.trim();
    const fileMatch = t.match(/^([^\s]+\.\w+):(\d+):(\d+):\s*(error|warning|note|help)\b/i);
    if (fileMatch) {
      const file = fileMatch[1]!;
      const severity = fileMatch[4]!.toLowerCase();
      if (!byFile.has(file)) byFile.set(file, { errors: [], warnings: [], notes: [] });
      const entry = byFile.get(file)!;
      const afterSev = t.slice(t.indexOf(severity) + severity.length).trim();
      const codeMsg = afterSev.replace(/^\[?[\w\d]+\]?:?\s*/, "").slice(0, 100);
      if (severity === "error") entry.errors.push(codeMsg);
      else if (severity === "warning" || severity === "warn") entry.warnings.push(codeMsg);
      else entry.notes.push(codeMsg);
    }
  }

  if (byFile.size === 0) return null;

  const result: string[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  const sorted = [...byFile.entries()].sort((a, b) => b[1].errors.length - a[1].errors.length);

  for (const [file, diag] of sorted) {
    totalErrors += diag.errors.length;
    totalWarnings += diag.warnings.length;
    const shortFile = file.split("/").pop() ?? file;
    const parts: string[] = [];
    if (diag.errors.length > 0) parts.push(`${diag.errors.length}e`);
    if (diag.warnings.length > 0) parts.push(`${diag.warnings.length}w`);
    result.push(`${shortFile} (${parts.join(" ")})`);
    for (const e of diag.errors.slice(0, 2)) result.push(`  e: ${e}`);
    if (diag.errors.length > 2) result.push(`  ... +${diag.errors.length - 2} more`);
    for (const w of diag.warnings.slice(0, 1)) result.push(`  w: ${w}`);
    if (diag.warnings.length > 1) result.push(`  ... +${diag.warnings.length - 1} more`);
  }

  const compressed = `[compiler: ${byFile.size}f ${totalErrors}e ${totalWarnings}w]` +
    (result.length > 0 ? `\n${result.join("\n")}` : "");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "compiler-diagnostics", compressed };
}
