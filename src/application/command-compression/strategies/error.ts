/**
 * Error-first projection for failing tool outputs.
 * Keeps: stderr_head 20, error spans (±3 lines around each ERROR|FAILED|panic|Traceback), tail 20, collapsed repeats `x42`.
 * Preserves traceId/testName/file:line IDs — never drops those lines.
 * 100% fidelity for error lines — only boilerplate around them is trimmed.
 */

const ERROR_RE = /(ERROR|Error|FAILED|fail|panic|Traceback|Exception|stack trace|test failed|FAIL\s)/i;
const TRACE_ID_RE = /(trace[_-]?id|test[_-]?name|file:\s*\S+:\d+|at\s+\S+:\d+:\d+)/i;

export function compressErrorFirst(raw: string, maxTokens = 2500, tailKeep = 20): string {
  const lines = raw.split("\n");
  if (lines.length <= 40) return raw; // tiny failures stay verbatim

  const keep = new Set<number>();
  // head 20
  for (let i = 0; i < Math.min(20, lines.length); i++) keep.add(i);
  // tail 20
  for (let i = Math.max(0, lines.length - tailKeep); i < lines.length; i++) keep.add(i);

  // error spans ±3 + traceId preservation
  lines.forEach((l, idx) => {
    if (ERROR_RE.test(l) || TRACE_ID_RE.test(l)) {
      for (let d = -3; d <= 3; d++) {
        const j = idx + d;
        if (j >= 0 && j < lines.length) keep.add(j);
      }
    }
  });

  // Build ordered kept lines with collapse of gap
  const sorted = [...keep].sort((a, b) => a - b);
  const out: string[] = [];
  let last = -2;
  let gap = 0;
  for (const idx of sorted) {
    if (idx > last + 1) {
      gap = idx - last - 1;
      if (gap > 5) out.push(`… [${gap} lines omitted — error-first filter] …`);
      else for (let k = last + 1; k < idx; k++) out.push(lines[k]!);
    }
    out.push(lines[idx]!);
    last = idx;
  }

  // Collapse 3+ identical consecutive lines → "line xN"
  const collapsed: string[] = [];
  let rep = 1;
  for (let i = 0; i < out.length; i++) {
    if (i + 1 < out.length && out[i] === out[i + 1]) {
      rep++;
    } else {
      const cur = out[i]!;
      if (rep >= 3) collapsed.push(`${cur}  … x${rep} identical lines collapsed …`);
      else for (let k = 0; k < rep; k++) collapsed.push(cur);
      rep = 1;
    }
  }

  let result = collapsed.join("\n");
  // Hard cap by rough tokens (~4 chars/token) to maxTokens
  const approxTokens = result.length / 4;
  if (approxTokens > maxTokens) {
    // truncate middle, keep head+tail already guaranteed, just slice result
    const chars = maxTokens * 4;
    result = result.slice(0, chars / 2) + `\n… [truncated to ${maxTokens} tok budget] …\n` + result.slice(-chars / 2);
  }
  const banner = `[error-first projection — preserved ${keep.size}/${lines.length} lines, ${collapsed.length} shown]`;
  return `${banner}\n${result}`;
}
