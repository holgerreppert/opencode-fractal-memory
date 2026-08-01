import { scoreLine, extractQueryTerms } from "./utils";
import type { CompressConfig } from "./config";

export function trimByRelevance(raw: string, command: string, config: CompressConfig, intentTerms?: string[]): string {
  const threshold = config.relevanceTrimmingThreshold ?? 15;
  const minKeep = config.relevanceTrimmingMinKeep ?? 5;
  const alwaysKeepTop = config.relevanceTrimmingAlwaysKeepTop ?? 3;

  const lines = raw.split("\n");
  if (lines.length <= minKeep + alwaysKeepTop) return raw;

  const terms = extractQueryTerms(command);
  const allTerms = intentTerms ? [...new Set([...terms, ...intentTerms.map(t => t.toLowerCase())])] : terms;

  // Score each line
  const total = lines.length;
  const scored: { line: string; score: number; idx: number }[] = [];
  for (let i = 0; i < total; i++) {
    const s = scoreLine(lines[i]!, allTerms, i, total);
    scored.push({ line: lines[i]!, score: s, idx: i });
  }

  // Keep top-scoring lines by original order
  const kept = new Set<number>();
  for (const s of scored) {
    if (s.idx < alwaysKeepTop || s.score >= threshold) {
      kept.add(s.idx);
    }
  }

  if (kept.size < minKeep) {
    const candidates = scored
      .filter(s => !kept.has(s.idx))
      .sort((a, b) => b.score - a.score);
    for (const s of candidates) {
      if (kept.size >= minKeep) break;
      kept.add(s.idx);
    }
  }

  const resultLines = lines.filter((_, idx) => kept.has(idx));
  if (resultLines.length === lines.length || resultLines.length <= 1) return raw;

  const result = resultLines.join("\n");
  if (result.length > raw.length * 0.9) return raw;

  return result;
}
