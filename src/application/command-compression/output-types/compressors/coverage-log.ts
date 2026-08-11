import type { OutputTypeResult } from "../types";

export function compressCoverageLog(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const fileResults: string[] = [];
  let overallLine = "";

  for (const line of lines) {
    const t = line.trim();
    if (/All files\s*\|/.test(t) || /^\|\s*All files/i.test(t)) { overallLine = t; continue; }
    if (/^(File|Name)/.test(t) && t.includes("|")) { continue; }
    if (/^\|?\s*[\w./-]+\s*\|/.test(t)) {
      if (/\d+\.\d+|\d+%/.test(t)) {
        fileResults.push(t);
      }
    }
  }

  const result: string[] = [];
  const fileCount = fileResults.length;
  if (overallLine) {
    const overallPct = overallLine.match(/(\d+\.?\d*)%?/);
    result.push(`coverage: ${fileCount} files${overallPct ? `, overall ${overallPct[1]}%` : ""}`);
  } else {
    result.push(`coverage: ${fileCount} files`);
  }

  fileResults.sort((a, b) => {
    const ap = a.match(/(\d+\.\d+)%?/);
    const bp = b.match(/(\d+\.\d+)%?/);
    return (ap ? parseFloat(ap[1]!) : 100) - (bp ? parseFloat(bp[1]!) : 100);
  });

  for (const fr of fileResults.slice(0, 5)) {
    result.push(`  ${fr.trim().slice(0, 120)}`);
  }
  if (fileResults.length > 5) result.push(`  ... +${fileResults.length - 5} more files`);

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "coverage-log", compressed };
}
