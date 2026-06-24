import { writeCompressLog } from "../../logging";
import { contentPreview } from "./utils";
import type { CompressConfig } from "./config";

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "not", "but", "all", "any", "can", "has",
  "was", "get", "set", "run", "use", "new", "out", "how", "why", "what",
  "this", "that", "with", "from", "each", "every", "some", "into", "over",
  "also", "its", "than", "then", "been", "have", "were", "when", "where",
]);

const COMMON_COMMANDS = new Set([
  "ls", "cat", "grep", "find", "npm", "git", "cd", "echo", "head", "tail",
  "sort", "wc", "cut", "tee", "more", "less", "sed", "awk", "tr", "uniq",
  "mkdir", "rmdir", "rm", "cp", "mv", "chmod", "chown", "touch", "pwd",
  "type", "which", "alias", "source", "export", "exit", "clear", "time",
]);

function extractQueryTerms(command: string): string[] {
  const terms = new Set<string>();

  const quotedMatches = command.match(/"[^"]*"|'[^']*`/g);
  if (quotedMatches) {
    for (const m of quotedMatches) {
      const inner = m.replace(/["']/g, "").trim();
      if (inner) {
        for (const t of inner.split(/[/.\s_-]+/)) {
          const cleaned = t.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
          if (cleaned.length >= 3 && !STOP_WORDS.has(cleaned) && !COMMON_COMMANDS.has(cleaned)) {
            terms.add(cleaned);
          }
        }
      }
    }
  }

  const tokens = command.split(/[/.\s_"'=()@$|&;]+/);
  for (const t of tokens) {
    const cleaned = t.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    if (cleaned.length >= 3 && !STOP_WORDS.has(cleaned) && !COMMON_COMMANDS.has(cleaned)) {
      terms.add(cleaned);
    }
  }

  return [...terms];
}

export function trimByRelevance(raw: string, command: string, config: CompressConfig): string {
  const threshold = config.relevanceTrimmingThreshold ?? 0.15;
  const minKeep = config.relevanceTrimmingMinKeep ?? 5;
  const alwaysKeepTop = config.relevanceTrimmingAlwaysKeepTop ?? 3;

  const lines = raw.split("\n");
  if (lines.length <= minKeep + alwaysKeepTop) return raw;

  const queryTerms = extractQueryTerms(command);
  if (queryTerms.length === 0) return raw;

  const lowerLines = lines.map(l => l.toLowerCase());
  const tokenizedLines = lowerLines.map(l => l.split(/[^a-z0-9]+/).filter(Boolean));

  const totalLines = lines.length;
  const termDocFreq = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const tokens of tokenizedLines) {
      if (tokens.includes(term)) count++;
    }
    termDocFreq.set(term, count);
  }

  const scored: { line: string; score: number; idx: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i < alwaysKeepTop) {
      scored.push({ line: lines[i]!, score: Infinity, idx: i });
      continue;
    }
    const tokens = tokenizedLines[i] ?? [];
    if (tokens.length === 0) {
      scored.push({ line: lines[i]!, score: 0, idx: i });
      continue;
    }
    let score = 0;
    for (const term of queryTerms) {
      const tf = tokens.filter(t => t === term).length / tokens.length;
      const df = termDocFreq.get(term) ?? 0;
      const idf = Math.log(1 + totalLines / (1 + df));
      score += tf * idf;
    }
    scored.push({ line: lines[i]!, score, idx: i });
  }

  const keptIndices = new Set<number>();
  for (const s of scored) {
    if (s.idx < alwaysKeepTop || s.score >= threshold) {
      keptIndices.add(s.idx);
    }
  }

  if (keptIndices.size < minKeep) {
    const candidates = scored
      .filter(s => !keptIndices.has(s.idx))
      .sort((a, b) => b.score - a.score);
    for (const s of candidates) {
      if (keptIndices.size >= minKeep) break;
      keptIndices.add(s.idx);
    }
  }

  const resultLines = lines.filter((_, idx) => keptIndices.has(idx));
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
    query_terms: queryTerms.length,
    reduction_pct: Math.round((1 - result.length / Math.max(raw.length, 1)) * 100),
    duration_ms: 0,
    failed: 0,
    before_snippet: contentPreview(raw),
    after_snippet: contentPreview(result),
  });

  return result;
}
