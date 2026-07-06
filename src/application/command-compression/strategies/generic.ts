import { scoreLine, extractQueryTerms } from "../utils";
import { compressByType } from "../output-types";

export function compressGeneric(raw: string, maxLines: number): string {
  if (!raw || raw.length < 80) return raw;

  const typeResult = compressByType(raw, maxLines);
  if (typeResult) return typeResult.compressed;

  return raw;
}

export function compressRelevantGeneric(raw: string, maxLines: number, cmd: string): string {
  if (!raw || raw.length < 80) return raw;

  const typeResult = compressByType(raw, maxLines);
  if (typeResult) return typeResult.compressed;

  const lines = raw.split("\n");
  if (lines.length <= maxLines) return raw;

  const terms = extractQueryTerms(cmd);
  const total = lines.length;

  const scored: { line: string; score: number; idx: number }[] = [];
  for (let i = 0; i < total; i++) {
    scored.push({ line: lines[i]!, score: scoreLine(lines[i]!, terms, i, total), idx: i });
  }

  const kept = new Set<number>();
  const sorted = [...scored].sort((a, b) => b.score - a.score).slice(0, maxLines);
  for (const s of sorted) kept.add(s.idx);

  const result: string[] = [];
  const dropped = lines.length - kept.size;

  for (let i = 0; i < total; i++) {
    if (i < 2 || kept.has(i) || i + 2 >= total) {
      result.push(lines[i]!);
    }
  }

  if (result.length >= lines.length) return raw;

  const truncated = result.join("\n");
  if (truncated.length > raw.length * 0.9) return raw;

  return `[relevant: kept ${result.length} of ${lines.length} lines — ${dropped} elided]\n${result.join("\n")}`;
}
