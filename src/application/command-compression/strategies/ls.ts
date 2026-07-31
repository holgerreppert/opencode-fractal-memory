export function compressLs(raw: string, keepNames = 50): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return raw;

  const entries: string[] = [];
  let dirs = 0;
  let files = 0;

  for (const line of lines) {
    const cleaned = line.replace(/^total \d+/, "").trim();
    if (!cleaned) continue;
    if (cleaned.endsWith("/")) {
      const name = cleaned.replace(/\/$/, "").replace(/.*\s+/, "");
      entries.push(`${name}/`);
      dirs++;
    } else {
      const name = cleaned.replace(/.*\s+/, "");
      entries.push(name);
      files++;
    }
  }

  if (entries.length === 0) return raw;

  // Filenames are the payload: keep them verbatim when they fit.
  if (entries.length <= keepNames) return raw;

  const result = [
    ...entries.slice(0, keepNames),
    `… +${entries.length - keepNames} more (${dirs} dirs, ${files} files)`,
  ];
  return result.join("\n");
}
