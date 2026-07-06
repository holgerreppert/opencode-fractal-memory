import { writeCompressLog } from "../../logging";
import { contentPreview, scoreLine, extractQueryTerms } from "./utils";
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

  const dropped = lines.length - resultLines.length;
  writeCompressLog({
    action: "relevance-trim",
    strategy: "relevance-trim",
    cmd_preview: command.replace(/\s+/g, " ").trim().slice(0, 60),
    original_chars: raw.length,
    compressed_chars: result.length,
    original_lines: lines.length,
    compressed_lines: resultLines.length,
    dropped_lines: dropped,
    query_terms: terms.length,
    reduction_pct: Math.round((1 - result.length / Math.max(raw.length, 1)) * 100),
    duration_ms: 0,
    failed: 0,
    before_snippet: contentPreview(raw),
    after_snippet: contentPreview(result),
  });

  return result;
}
