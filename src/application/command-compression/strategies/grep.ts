export function compressGrep(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length <= 3) return raw;

  const isCountFormat = lines.every(l => /^.+?:\d+$/.test(l));
  if (isCountFormat) return raw;

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

  // Group by file extension for additional overview
  const extGroups = new Map<string, number>();
  for (const [file] of entries) {
    const ext = file.includes(".") ? file.split(".").pop() ?? "no-ext" : "no-ext";
    extGroups.set(ext, (extGroups.get(ext) ?? 0) + 1);
  }
  const extSummary = [...extGroups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ext, count]) => `${ext}: ${count} file${count !== 1 ? "s" : ""}`)
    .join(", ");

  const result: string[] = [`${total} matches across ${fileCounts.size} files (${extSummary})`];
  for (const [file, count] of entries.slice(0, 10)) {
    result.push(`  ${file}: ${count} match${count !== 1 ? "es" : ""}`);
  }
  if (entries.length > 10) result.push(`  ... +${entries.length - 10} more files`);

  const out = result.join("\n");
  return out.length < raw.length ? out : raw;
}
