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
