export function compressGrep(raw: string, keepMatches = 15): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length <= 3) return raw;

  const isCountFormat = lines.every(l => /^.+?:\d+$/.test(l));
  if (isCountFormat) return raw;

  // Strict path:line[:content] detection. The prefix must look like a file path
  // (contains "/" or ".") and the next segment must be a line number. This
  // rejects ps/table-style lines like "5 77916996 1229920 pts/0 Sl+ 11:03:24".
  const matched: { file: string; line: string }[] = [];
  for (const line of lines) {
    const m = /^(.+?):(\d+)(?::(.*))?$/.exec(line);
    if (!m) return raw;
    const file = (m[1] ?? "").trim();
    if (!file.includes("/") && !file.includes(".")) return raw;
    if (/^\d/.test(file)) return raw;
    matched.push({ file, line });
  }

  if (matched.length === 0) return raw;

  // Payload is the answer: keep matches verbatim when they fit.
  if (matched.length <= keepMatches) return raw;

  const fileCounts = new Map<string, number>();
  for (const m of matched) {
    fileCounts.set(m.file, (fileCounts.get(m.file) ?? 0) + 1);
  }
  const entries = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);

  const result: string[] = [
    `${matched.length} matches across ${entries.length} files — first ${keepMatches} shown:`,
    ...matched.slice(0, keepMatches).map(m => m.line),
    `… +${matched.length - keepMatches} more matches`,
    ...entries.slice(0, 10).map(([file, count]) => `  ${file}: ${count} match${count !== 1 ? "es" : ""}`),
  ];
  if (entries.length > 10) result.push(`  ... +${entries.length - 10} more files`);

  const out = result.join("\n");
  return out.length < raw.length ? out : raw;
}
