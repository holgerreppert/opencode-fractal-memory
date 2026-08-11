import type { OutputType, OutputTypeResult } from "../types";

export function compressRawText(raw: string, maxLines: number): OutputTypeResult {
  const lines = raw.split("\n");
  const deduped: string[] = [];
  let dupCount = 1;
  for (let i = 0; i < lines.length; i++) {
    const prev = i > 0 ? lines[i - 1] : null;
    if (prev !== null && lines[i] === prev) { dupCount++; continue; }
    if (dupCount > 1 && deduped.length > 0) { deduped[deduped.length - 1] += ` (×${dupCount})`; dupCount = 1; }
    deduped.push(lines[i] ?? "");
  }
  if (dupCount > 1 && deduped.length > 0) { deduped[deduped.length - 1] += ` (×${dupCount})`; }

  if (deduped.length <= maxLines) {
    const out = deduped.join("\n");
    return out.length < raw.length * 0.9 ? { type: "raw-text" as OutputType, compressed: out } : null;
  }

  const signalLines: number[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const t = deduped[i]!.toLowerCase();
    if (/\b(error|fail|exception|warn|cannot|not found|missing|invalid)\b/.test(t) || /at\s+\S+\.\S+\s*\(/.test(deduped[i]!)) {
      signalLines.push(i);
    }
  }

  const headCount = Math.min(3, maxLines);
  const tailCount = Math.min(2, maxLines - headCount);
  const signalBudget = Math.max(0, maxLines - headCount - tailCount);

  const kept = new Set<number>();
  for (let i = 0; i < headCount; i++) kept.add(i);
  for (let i = deduped.length - tailCount; i < deduped.length; i++) kept.add(i);
  for (const idx of signalLines.slice(0, signalBudget)) kept.add(idx);

  if (kept.size < maxLines) {
    for (let i = headCount; i < deduped.length - tailCount; i++) {
      if (kept.size >= maxLines) break;
      kept.add(i);
    }
  }

  const result: string[] = [];
  const dropped = deduped.length - kept.size;
  for (let i = 0; i < deduped.length; i++) {
    if (kept.has(i)) result.push(deduped[i]!);
  }

  const compressed = `[kept ${result.length} of ${deduped.length} lines — ${dropped} elided]\n${result.join("\n")}`;
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "raw-text", compressed };
}
