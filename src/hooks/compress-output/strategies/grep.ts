export function compressGrep(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length <= 3) return raw;

  const isCountFormat = lines.every(l => /^.+?:\d+$/.test(l));
  if (isCountFormat) {
    return raw;
  }

  const fileCounts = new Map<string, number>();
  const fileRe = /^(.+?):/;

  for (const line of lines) {
    const m = fileRe.exec(line);
    if (m) {
      const f = (m[1] ?? "").trim();
      if (f) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    }
  }

  if (fileCounts.size === 0) return raw;

  const total = lines.length;
  const entries = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);

  const result: string[] = [`${total} matches across ${fileCounts.size} files:`];
  for (const [file, count] of entries.slice(0, 15)) {
    result.push(`  ${file}: ${count} match${count !== 1 ? "es" : ""}`);
  }
  if (entries.length > 15) result.push(`  ... +${entries.length - 15} more files`);

  const out = result.join("\n");
  return out.length < raw.length ? out : raw;
}
