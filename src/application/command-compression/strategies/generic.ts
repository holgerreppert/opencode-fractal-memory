import { scoreLine, extractQueryTerms } from "../utils";

export function compressGeneric(raw: string, maxLines: number): string {
  const lines = raw.split("\n");
  const deduped: string[] = [];
  let dupCount = 1;
  for (let i = 0; i < lines.length; i++) {
    const prev = i > 0 ? lines[i - 1] : null;
    if (prev !== null && lines[i] === prev) {
      dupCount++;
      continue;
    }
    if (dupCount > 1 && deduped.length > 0) {
      deduped[deduped.length - 1] += ` (×${dupCount})`;
      dupCount = 1;
    }
    deduped.push(lines[i] ?? "");
  }
  if (dupCount > 1 && deduped.length > 0) {
    deduped[deduped.length - 1] += ` (×${dupCount})`;
  }

  if (deduped.length <= maxLines) return deduped.join("\n");
  const remaining = deduped.length - maxLines;
  const mid = Math.floor(maxLines / 2);
  const head = deduped.slice(0, mid);
  const tail = deduped.slice(-mid);
  head.push(`... truncated: ${remaining} lines omitted, showing head + tail ...`);
  head.push(...tail);
  return head.join("\n");
}

export function compressRelevantGeneric(raw: string, maxLines: number, cmd: string): string {
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

  // Keep head for context, then high-score lines in order, then tail
  for (let i = 0; i < total; i++) {
    if (i < 2 || kept.has(i) || i + 2 >= total) {
      result.push(lines[i]!);
    }
  }

  // If everything kept, return raw
  if (result.length >= lines.length) return raw;

  const truncated = result.join("\n");
  if (truncated.length > raw.length * 0.9) return raw;

  return `[relevant: kept ${result.length} of ${lines.length} lines — ${dropped} elided]\n${result.join("\n")}`;
}
