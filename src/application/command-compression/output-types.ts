export type OutputType = "build-log" | "dep-tree" | "log-stream" | "config-content" | "raw-text";
export type OutputTypeResult = { type: OutputType; compressed: string } | null;

const BUILD_PATTERNS = [
  /webpack/,
  /vite/,
  /esbuild/,
  /tsc\b/,
  /babel/,
  /rollup/,
  /parcel/,
  /snowpack/,
  /turbo/,
  /npx\s/,
  />\s+\S+\s+\//,
  /\d+:\d+:\d+(?:\.\d+)?\s+(?:ERROR|WARN|INFO|error|warn)/,
];
const TIMESTAMP_RE = /^\[\d{1,2}:\d{2}:\d{2}/;
const DEP_TREE_RE = /^[├└─│+]/;
const COMMON_DIRS = ["node_modules", "dist", "build", ".next", ".cache", "coverage"];

function detectBuildLog(raw: string): boolean {
  const lines = raw.split("\n");
  let buildMatches = 0;
  let progressBars = 0;
  for (const line of lines) {
    const t = line.trim();
    if (BUILD_PATTERNS.some(p => p.test(t))) buildMatches++;
    if (t.includes("█") || t.includes("░") || (t.includes("[") && t.includes("]") && t.includes("%"))) progressBars++;
    if (buildMatches >= 2 || (buildMatches >= 1 && progressBars >= 1)) return true;
  }
  return buildMatches >= 2;
}

function detectDepTree(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 2) return false;
  const treeLines = lines.filter(l => DEP_TREE_RE.test(l.trim()) || /^\s{2,}\S/.test(l));
  const ratio = treeLines.length / lines.length;
  return ratio > 0.6 && lines.some(l => l.includes("@") || l.includes("node_modules") || COMMON_DIRS.some(d => l.includes(d)));
}

function detectLogStream(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 3) return false;
  const timestamped = lines.filter(l => /^\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}/.test(l) || TIMESTAMP_RE.test(l) || /^\d{4}-\d{2}-\d{2}T/.test(l));
  return timestamped.length >= lines.length * 0.7;
}

function detectConfigContent(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 3) return false;
  const sectionHeaders = lines.filter(l => /^\[[\w\-. ]+\]$/.test(l.trim()) || /^#+ /.test(l.trim()));
  const keyValue = lines.filter(l => /^[\w.]+[\s]*[=:][\s]/.test(l.trim()) && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("#"));
  return sectionHeaders.length >= 2 || (keyValue.length >= lines.length * 0.4);
}

export function detectOutputType(raw: string): OutputType {
  if (detectBuildLog(raw)) return "build-log";
  if (detectDepTree(raw)) return "dep-tree";
  if (detectLogStream(raw)) return "log-stream";
  if (detectConfigContent(raw)) return "config-content";
  return "raw-text";
}

function compressBuildLog(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n");
  const errors: string[] = [];
  const warnings: string[] = [];
  const body: string[] = [];
  let progressCount = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes("█") || t.includes("░") || (t.includes("[") && t.includes("%"))) { progressCount++; continue; }
    const clean = t.replace(/^\[?\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\]?\s*/, "");
    if (/\b(ERROR|error|Error)\b/.test(clean)) errors.push(clean.slice(0, 200));
    else if (/\b(WARN|WARNING|warn|warning)\b/.test(clean)) warnings.push(clean.slice(0, 200));
    else body.push(clean);
  }

  const result: string[] = [];
  if (errors.length > 0) {
    result.push(`errors (${errors.length}):`);
    result.push(...errors.slice(0, 5).map(e => `  ${e}`));
    if (errors.length > 5) result.push(`  ... +${errors.length - 5} more error lines`);
  }
  if (warnings.length > 0) {
    result.push(`warnings (${warnings.length}):`);
    result.push(...warnings.slice(0, 3).map(w => `  ${w}`));
    if (warnings.length > 3) result.push(`  ... +${warnings.length - 3} more warning lines`);
  }

  const keepAfterErrors = 5;
  const bodyToUse = body.length <= keepAfterErrors ? body : [...body.slice(0, 3), `... ${body.length - keepAfterErrors} lines omitted`, ...body.slice(-2)];
  result.push(...bodyToUse);

  if (progressCount > 0) result.unshift(`[progress: ${progressCount} progress lines]`);

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "build-log", compressed };
}

function compressDepTree(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const topLevel: string[] = [];
  let totalDeps = 0;
  let errors: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (/^(?:│|├──|└──)/.test(t.replace(/^\s{2,}/, "")) === false && !t.startsWith("├──") && !t.startsWith("└──") && !t.startsWith("│")) {
      if (t && !t.startsWith(" ") && !t.startsWith("│") && !t.startsWith("├") && !t.startsWith("└")) {
        if (topLevel.length < 10) topLevel.push(t.replace(/@\d+\.\d+.*$/, "@ver"));
      }
    }
    if (t) totalDeps++;
    if (/\b(ERR|error|not found|missing|UNMET)\b/i.test(t)) errors.push(t);
  }

  const result: string[] = [];
  if (topLevel.length > 0) result.push(`packages (${topLevel.length}): ${topLevel.join(", ")}`);
  result.push(`total deps: ${totalDeps}`);
  if (errors.length > 0) result.push(`errors: ${errors.slice(0, 3).join("; ")}`);
  if (result.length === 1) result.push(lines.slice(0, 3).join("\n"));

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "dep-tree", compressed };
}

function compressLogStream(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const bySeverity: Record<string, string[]> = { ERROR: [], WARN: [], WARNING: [], INFO: [], DEBUG: [], TRACE: [], unknown: [] };

  for (const line of lines) {
    const upper = line.toUpperCase();
    let matched = false;
    for (const [pattern, key] of [[/\bERROR\b/, "ERROR"], [/\bWARNING\b|\bWARN\b/, "WARN"], [/\bINFO\b/, "INFO"], [/\bDEBUG\b/, "DEBUG"], [/\bTRACE\b/, "TRACE"]] as const) {
      if (pattern.test(upper)) { bySeverity[key]!.push(line); matched = true; break; }
    }
    if (!matched) bySeverity["unknown"]!.push(line);
  }

  const result: string[] = [];
  for (const sev of ["ERROR", "WARN", "INFO", "DEBUG", "TRACE", "unknown"]) {
    if (!bySeverity[sev] || bySeverity[sev]!.length === 0) continue;
    const count = bySeverity[sev]!.length;
    result.push(`${sev} (${count}):`);
    if (sev === "ERROR" || sev === "WARN") {
      result.push(...bySeverity[sev]!.slice(0, 3).map(l => `  ${l.slice(0, 200)}`));
      if (count > 3) result.push(`  ... +${count - 3} more`);
    }
  }

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "log-stream", compressed };
}

function compressConfigContent(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const sections: string[] = [];
  const inSection = new Map<string, number>();
  let currentSection = "(root)";

  for (const line of lines) {
    const t = line.trim();
    const sectionMatch = /^\[([\w\-. ]+)\]$/.exec(t);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      sections.push(currentSection);
      inSection.set(currentSection, 0);
    } else if (t && !t.startsWith("#") && !t.startsWith("//") && t.includes("=")) {
      inSection.set(currentSection, (inSection.get(currentSection) ?? 0) + 1);
    }
  }

  const result: string[] = [];
  result.push(`${sections.length} sections, ${inSection.size > 0 ? Array.from(inSection.values()).reduce((a, b) => a + b, 0) : lines.length} entries`);
  if (sections.length <= 15) {
    for (const s of sections) {
      const count = inSection.get(s) ?? 0;
      result.push(`  [${s}]${count > 0 ? ` (${count} keys)` : ""}`);
    }
  } else {
    result.push(`sections: ${sections.slice(0, 10).join(", ")}${sections.length > 10 ? ` ... +${sections.length - 10} more` : ""}`);
  }

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "config-content", compressed };
}

function compressRawText(raw: string, maxLines: number): OutputTypeResult {
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

export function compressByType(raw: string, maxLines: number, explicitType?: OutputType): OutputTypeResult | null {
  if (!raw || raw.length < 80) return null;
  const type = explicitType ?? detectOutputType(raw);

  switch (type) {
    case "build-log": return compressBuildLog(raw, maxLines);
    case "dep-tree": return compressDepTree(raw, maxLines);
    case "log-stream": return compressLogStream(raw, maxLines);
    case "config-content": return compressConfigContent(raw, maxLines);
    case "raw-text": return compressRawText(raw, maxLines);
  }
}
