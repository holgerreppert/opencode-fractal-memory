import { compressGeneric } from "./strategies/generic";

type OutputShape = "json" | "csv" | "stack-trace" | "tree" | "table" | "unknown";

export function classifyShape(raw: string): OutputShape {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try { JSON.parse(trimmed); return "json"; } catch { /* not valid JSON */ }
  }
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length >= 3) {
    const header = lines[0] ?? "";
    const commaCount = (header.match(/,/g) || []).length;
    const tabCount = (header.match(/\t/g) || []).length;
    if ((commaCount >= 2 || tabCount >= 2) && lines.length >= 2) {
      const sep = commaCount > tabCount ? "," : "\t";
      const cols = header.split(sep).length;
      const consistent = lines.slice(1).every(l => l.split(sep).length >= cols - 1);
      if (consistent && cols >= 2) return "csv";
    }
  }
  if (/at\s+\S+\.\S+\s*\(/.test(raw) || /File\s+"[^"]+",\s+line\s+\d+/i.test(raw)) {
    return "stack-trace";
  }
  if (lines.some(l => /^(?:│|├──|└──| {2}├──| {2}└──)/.test(l) || /^\s*[│├└]/u.test(l))) {
    return "tree";
  }
  // Table: header + rows must be consistent. Count whitespace-separated tokens
  // (≥3) OR, for aligned tables with multi-word cells (docker ps), require each
  // row to have at least as many 2+space-delimited cells as the header.
  if (lines.length >= 3) {
    const header = lines[0] ?? "";
    const colCount = header.trim().split(/\s+/).length;
    const headerAligned = header.split(/\s{2,}/).length;
    if (colCount >= 2) {
      let consistent = 0;
      for (const l of lines.slice(1)) {
        const c = l.trim().split(/\s+/).length;
        if (c === colCount || c === colCount + 1) { consistent++; continue; }
        if (headerAligned >= 2 && l.split(/\s{2,}/).length >= headerAligned) consistent++;
      }
      if (consistent >= Math.max(2, Math.floor(lines.length * 0.6))) {
        return "table";
      }
    }
  }
  return "unknown";
}

function compressJson(raw: string, maxLines: number): string {
  try {
    const parsed = JSON.parse(raw.trim());
    const summary = (obj: unknown, depth = 0): string => {
      if (depth > 2) return "...";
      if (Array.isArray(obj)) return `Array(${obj.length})`;
      if (obj !== null && typeof obj === "object") {
        const keys = Object.keys(obj as Record<string, unknown>);
        return `Object(${keys.length} keys${keys.length <= 10 ? `: ${keys.join(", ")}` : ""})`;
      }
      return String(obj);
    };
    const result = summary(parsed);
    return `[JSON: ${result}]`;
  } catch {
    return compressGeneric(raw, maxLines);
  }
}

function compressCsv(raw: string, _maxLines: number): string {
  const lines = raw.split("\n").filter(Boolean);
  const header = lines[0] ?? "";
  const sep = (header.match(/,/g) || []).length >= (header.match(/\t/g) || []).length ? "," : "\t";
  const colCount = header.split(sep).length;
  const dataLines = lines.slice(1).filter(l => l.trim());
  const sample = dataLines.slice(0, 3).map(l => l.slice(0, 80)).join("\n");
  const result = `${lines.length} rows, ${colCount} columns\nHeader: ${header.slice(0, 120)}\n${dataLines.length > 0 ? `First:\n${sample}` : ""}`;
  return result;
}

function compressStackTrace(raw: string, _maxLines: number): string {
  const lines = raw.split("\n");
  const uniqueFrames = new Set<string>();
  const errors: string[] = [];
  let i = 0;
  for (const line of lines) {
    if (/^(?:Error|TypeError|SyntaxError|ReferenceError|RangeError|AssertionError)/i.test(line.trim())) {
      errors.push(line.trim());
    }
    const m = /at\s+(.+)/.exec(line.trim());
    if (m) {
      uniqueFrames.add(m[1]!.replace(/\s*\(.*\)/, "").trim());
    }
    i++;
  }
  const result = [
    errors.slice(0, 5).join("\n"),
    `${uniqueFrames.size} unique frames:`,
    ...Array.from(uniqueFrames).slice(0, 15).map(f => `  at ${f}`),
    uniqueFrames.size > 15 ? `  ... +${uniqueFrames.size - 15} more` : "",
  ].filter(Boolean).join("\n");
  return result;
}

function compressTree(raw: string, _maxLines: number): string {
  const lines = raw.split("\n").filter(Boolean);
  const dirs: string[] = [];
  const files: string[] = [];
  const depth = Math.max(...lines.map(l => (l.match(/[│├└]/g) || []).length));
  for (const line of lines) {
    const name = line.replace(/^[│ ├└─]*/, "").trim();
    if (!name) continue;
    if (name.endsWith("/") || line.includes("├") || line.includes("└")) {
      if (name.endsWith("/") || !name.includes(".")) dirs.push(name);
      else files.push(name);
    } else {
      files.push(name);
    }
  }
  const result = `depth ${depth}: ${dirs.length} dirs, ${files.length} files`;
  return result;
}

function compressTable(raw: string, keepRows = 20, essentialColumns?: string[]): string {
  const lines = raw.split("\n").filter(Boolean);
  const header = lines[0] ?? "";
  const dataLines = lines.slice(1);

  let display: string[];
  if (essentialColumns && essentialColumns.length > 0) {
    // Trim rows to the requested columns (by header name match).
    const headerCells = header.split(/\s{2,}/);
    const wantedIdx = essentialColumns
      .map(col => headerCells.findIndex(h => h.trim().toUpperCase().startsWith(col.toUpperCase())))
      .filter(i => i >= 0);
    if (wantedIdx.length > 0) {
      const trimmedHeader = wantedIdx.map(i => headerCells[i]).join("  ");
      const trimmedRows = dataLines.map(l => {
        const cells = l.split(/\s{2,}/);
        return wantedIdx.map(i => cells[i] ?? "").join("  ").trimEnd();
      });
      display = [trimmedHeader, ...trimmedRows];
    } else {
      display = lines;
    }
  } else {
    display = lines;
  }

  // The table is the payload: keep rows verbatim when they fit.
  if (dataLines.length <= keepRows) return raw;

  const result = [...display.slice(0, keepRows + 1), `… +${dataLines.length - keepRows} more rows`].join("\n");
  return result;
}

export function applyShapeCompression(
  raw: string,
  maxLines: number,
  keepRows = 20,
  essentialColumns?: string[],
): { output: string; strategy: string } | null {
  const shape = classifyShape(raw);
  if (shape === "unknown") return null;

  let shaped: string | null = null;
  let shapeStrategy = "";
  switch (shape) {
    case "json": shaped = compressJson(raw, maxLines); shapeStrategy = "shape-json"; break;
    case "csv": shaped = compressCsv(raw, maxLines); shapeStrategy = "shape-csv"; break;
    case "stack-trace": shaped = compressStackTrace(raw, maxLines); shapeStrategy = "shape-stack"; break;
    case "tree": shaped = compressTree(raw, maxLines); shapeStrategy = "shape-tree"; break;
    case "table": shaped = compressTable(raw, keepRows, essentialColumns); shapeStrategy = "shape-table"; break;
  }
  if (shaped && shaped !== raw && shaped.length < raw.length * 0.8) {
    return { output: shaped, strategy: shapeStrategy };
  }
  return null;
}
