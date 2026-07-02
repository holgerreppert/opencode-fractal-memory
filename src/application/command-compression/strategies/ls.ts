export function compressLs(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return raw;

  
  const dirs: string[] = [];
  const files: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/^total \d+/, "").trim();
    if (!cleaned) continue;
    if (cleaned.endsWith("/")) {
      const name = cleaned.replace(/\/$/, "").replace(/.*\s+/, "");
      dirs.push(name);
    } else {
      const name = cleaned.replace(/.*\s+/, "");
      files.push(name);
    }
  }

  const parts: string[] = [];
  if (dirs.length > 0) parts.push(`${dirs.length} dir${dirs.length !== 1 ? "s" : ""}`);
  if (files.length > 0) parts.push(`${files.length} file${files.length !== 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(", ") : raw;
}
