export type OutputType = "build-log" | "dep-tree" | "log-stream" | "config-content" | "source-code" | "compiler-diagnostics" | "test-output" | "npm-install" | "coverage-log" | "raw-text";
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

const CODE_LANG_PATTERNS = [
  // TypeScript/JavaScript
  { imports: [/^(import |export |from ["'])/], defs: [/^(function |class |interface |type |enum |const \w+[:=]|let \w+[:=]|var \w+[:=]|async function|arrow function)/] },
  // Python
  { imports: [/^(import |from \S+ import)/], defs: [/^(def |class |async def |@\w+)/] },
  // Rust
  { imports: [/^(use |pub use)/], defs: [/^(fn |pub fn|struct |enum |impl |trait |pub struct|pub enum|pub trait|type |pub type)/] },
  // Go
  { imports: [/^(import "|import \(|package )/], defs: [/^(func |type |struct |interface )/] },
  // Java/Kotlin
  { imports: [/^(import |package )/], defs: [/^(public |private |protected |class |interface |enum |fun |val |var )/] },
  // generic code indicators
  { imports: [/[{};]\s*$/], defs: [/^\s*\/\//, /^\s*#/] },
];

function detectSourceCode(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 3) return false;

  let importLines = 0;
  let defLines = 0;
  let totalSignificant = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("```")) continue;

    for (const lang of CODE_LANG_PATTERNS) {
      if (lang.imports.some(p => p.test(trimmed))) importLines++;
      if (lang.defs.some(p => p.test(trimmed))) defLines++;
    }

    // Detect code-like structure (indentation patterns + operators)
    if (/[{}=+\-*/%<>!&|^~?:;]/.test(trimmed) || /^\s{2,}\S/.test(line)) {
      totalSignificant++;
    }
  }

  // Source code if: at least 2 import/def lines OR strong structural indicators
  return (importLines >= 2 || defLines >= 2) ||
    (totalSignificant >= lines.length * 0.4 && lines.length >= 5);
}

function detectCompilerDiagnostics(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 2) return false;
  let diagLines = 0;
  for (const line of lines) {
    const t = line.trim();
    // Match: file.ts:line:col: error/warning, or error[code], or (col,row): error
    if (/^[A-Za-z]:\\/.test(t)) continue; // skip absolute Windows paths alone
    if (/\.\w+:\d+:\d+/.test(t) && /\b(error|warning|note|help)\s*\[?[\w\d()]+\]?:?\s/i.test(t)) {
      diagLines++;
    }
    if (diagLines >= 2) return true;
  }
  return false;
}

function detectTestOutput(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 3) return false;
  let testCount = 0;
  let failCount = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/\b(PASS|FAIL|✓|✗|×|✔|✘|ok\s+\d+|not ok\s+\d+)\b/.test(t)) testCount++;
    if (/\bFAIL|✗|×|not ok\b/.test(t)) failCount++;
    if (/^(Tests|Suites|Test Files):/.test(t)) return true;
    if (/^\s*(✓|✔|✗|✘|×|•)\s/.test(t)) testCount++;
    if (testCount >= 2) return true;
  }
  return false;
}

function detectNpmInstall(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 2) return false;
  let npmLines = 0;
  let hasAdded = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^(npm|yarn|pnpm|bun)\s+(install|add|remove|update)/i.test(t)) return true;
    if (t.startsWith("+ ")) hasAdded = true;
    if (/added \d+/.test(t) || /removed \d+/.test(t) || /changed \d+/.test(t)) npmLines++;
    if (/up to date/.test(t) || /audited \d+/.test(t)) npmLines++;
    if (npmLines >= 2) return true;
    if (hasAdded && npmLines >= 1) return true;
  }
  return false;
}

function detectCoverageLog(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 3) return false;
  let coverageLines = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/\b(\d+\.\d+\s*%|\d+\/\d+)\s+(\|\s+)?(statements|branches|functions|lines)\b/i.test(t)) {
      coverageLines++;
    }
    if (/^\|?\s*[\w./-]+\s*\|\s*\d+\.\d+\s/.test(t)) {
      coverageLines++;
    }
    if (/All files\s*\|/.test(t) || /File\s+\|/.test(t)) coverageLines += 2;
    if (/\|%\s*(covered|total)/i.test(t)) coverageLines++;
    if (coverageLines >= 2) return true;
  }
  return false;
}

function compressSourceCode(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n");
  const imports: string[] = [];
  const signatures: string[] = [];
  const errors: string[] = [];
  const other: string[] = [];
  let totalLines = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (trimmed.startsWith("```")) continue;

    // Collect import lines
    if (/^(import |export |from ["']|use |package |#include|#import)/.test(trimmed) && !/^import\s+type/.test(trimmed)) {
      if (imports.length < 15) imports.push(trimmed);
      continue;
    }

    // Collect function/class/interface signatures
    if ((/^(function |class |interface |type |enum |trait |impl |struct |pub |fn |def |async def)/.test(trimmed) ||
         /^(export (default )?(function|class|interface|type|enum|const|let|var))/.test(trimmed) ||
         /^(public|private|protected) (static )?(function|class|interface)/.test(trimmed) ||
         /^(const|let|var)\s+\w+\s*[:=]\s*(\(|[a-zA-Z])/.test(trimmed) ||
         /^(func |type |struct |interface )/.test(trimmed)) &&
        !signatures.some(s => s.includes(trimmed.slice(0, 40)))) {
      // Extract signature (before first { or :)
      const sigEnd = trimmed.indexOf("{");
      const sig = sigEnd >= 0 ? trimmed.slice(0, sigEnd).trim() : trimmed;
      if (sig.length < 150) signatures.push(sig + "; // L" + (i + 1));
      continue;
    }

    // Collect error-related lines
    if (/\b(ERROR|error|Error|FAIL|fail|Exception|exception)\b/.test(trimmed) &&
        /:\d+/.test(trimmed)) {
      errors.push(trimmed.slice(0, 200));
      continue;
    }

    other.push(trimmed.slice(0, 100));
  }

  const result: string[] = [];

  if (imports.length > 0) {
    result.push(`// imports (${imports.length})`);
    result.push(...imports);
  }

  if (signatures.length > 0) {
    result.push(`// signatures (${signatures.length})`);
    result.push(...signatures);
  }

  if (errors.length > 0) {
    result.push(`// errors (${errors.length})`);
    result.push(...errors.slice(0, 5));
    if (errors.length > 5) result.push(`// ... +${errors.length - 5} more error lines`);
  }

  if (result.length === 0) return null;

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  if (compressed.length > 4000) {
    return {
      type: "source-code",
      compressed: `[source-code: ${totalLines}→${result.length} lines — imports ${imports.length}, signatures ${signatures.length}, errors ${errors.length}]\n${result.join("\n")}`,
    };
  }
  return { type: "source-code", compressed: `[source-code: ${totalLines}→${result.length} lines — imports ${imports.length}, signatures ${signatures.length}, errors ${errors.length}]\n${result.join("\n")}` };
}

export function detectOutputType(raw: string): OutputType {
  if (detectBuildLog(raw)) return "build-log";
  if (detectCompilerDiagnostics(raw)) return "compiler-diagnostics";
  if (detectTestOutput(raw)) return "test-output";
  if (detectCoverageLog(raw)) return "coverage-log";
  if (detectNpmInstall(raw)) return "npm-install";
  if (detectSourceCode(raw)) return "source-code";
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

function compressCompilerDiagnostics(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const byFile = new Map<string, { errors: string[]; warnings: string[]; notes: string[] }>();

  for (const line of lines) {
    const t = line.trim();
    const fileMatch = t.match(/^([^\s]+\.\w+):(\d+):(\d+):\s*(error|warning|note|help)\b/i);
    if (fileMatch) {
      const file = fileMatch[1]!;
      const severity = fileMatch[4]!.toLowerCase();
      if (!byFile.has(file)) byFile.set(file, { errors: [], warnings: [], notes: [] });
      const entry = byFile.get(file)!;
      // Extract code and message, stripping duplicate severity word
      const afterSev = t.slice(t.indexOf(severity) + severity.length).trim();
      const codeMsg = afterSev.replace(/^\[?[\w\d]+\]?:?\s*/, "").slice(0, 100);
      if (severity === "error") entry.errors.push(codeMsg);
      else if (severity === "warning" || severity === "warn") entry.warnings.push(codeMsg);
      else entry.notes.push(codeMsg);
    }
  }

  if (byFile.size === 0) return null;

  const result: string[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  // Sort files by error count descending
  const sorted = [...byFile.entries()].sort((a, b) => b[1].errors.length - a[1].errors.length);

  for (const [file, diag] of sorted) {
    totalErrors += diag.errors.length;
    totalWarnings += diag.warnings.length;
    const shortFile = file.split("/").pop() ?? file;
    const parts: string[] = [];
    if (diag.errors.length > 0) parts.push(`${diag.errors.length}e`);
    if (diag.warnings.length > 0) parts.push(`${diag.warnings.length}w`);
    result.push(`${shortFile} (${parts.join(" ")})`);
    for (const e of diag.errors.slice(0, 2)) result.push(`  e: ${e}`);
    if (diag.errors.length > 2) result.push(`  ... +${diag.errors.length - 2} more`);
    for (const w of diag.warnings.slice(0, 1)) result.push(`  w: ${w}`);
    if (diag.warnings.length > 1) result.push(`  ... +${diag.warnings.length - 1} more`);
  }

  const compressed = `[compiler: ${byFile.size}f ${totalErrors}e ${totalWarnings}w]` +
    (result.length > 0 ? `\n${result.join("\n")}` : "");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "compiler-diagnostics", compressed };
}

function compressTestOutput(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  let passCount = 0;
  let failCount = 0;
  let totalCount = 0;
  const failures: string[] = [];
  let suiteResult = "";

  for (const line of lines) {
    const t = line.trim();
    if (/^(Tests|Suites|Test Files):/.test(t)) { suiteResult = t; continue; }
    if (/^\d+ passing/.test(t) || /^\d+ failing/.test(t)) { suiteResult = t; continue; }
    if (/^✓|^✔|PASS\s/.test(t)) { passCount++; continue; }
    if (/^✗|^✘|^×|FAIL\s/.test(t)) { failCount++; failures.push(t.slice(0, 200)); continue; }

    // Detect test framework specific output
    if (t.startsWith("ok ") || t.startsWith("not ok ")) {
      totalCount++;
      if (t.startsWith("not ok ")) { failCount++; failures.push(t.slice(0, 200)); }
      else passCount++;
    }
  }

  const result: string[] = [];
  if (suiteResult) result.push(suiteResult);
  else result.push(`tests: ${passCount + failCount} total, ${passCount} passed, ${failCount} failed`);

  if (failures.length > 0) {
    result.push(`failures (${failures.length}):`);
    result.push(...failures.slice(0, 5));
    if (failures.length > 5) result.push(`  ... +${failures.length - 5} more failures`);
  }

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "test-output", compressed };
}

function compressNpmInstall(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let audited = 0;
  let vulnerabilities = 0;
  const newPkgs: string[] = [];
  let inProgress = false;

  for (const line of lines) {
    const t = line.trim();
    const addMatch = t.match(/^\+ (\S+@\S+)/);
    if (addMatch) { added++; newPkgs.push(addMatch[1]!); continue; }
    const removeMatch = t.match(/^- (\S+@\S+)/);
    if (removeMatch) { removed++; continue; }

    if (/^added\s+(\d+)/i.test(t)) added = Math.max(added, parseInt(t.match(/^added\s+(\d+)/i)![1]!));
    if (/^removed\s+(\d+)/i.test(t)) removed = Math.max(removed, parseInt(t.match(/^removed\s+(\d+)/i)![1]!));
    if (/^changed\s+(\d+)/i.test(t)) changed = Math.max(changed, parseInt(t.match(/^changed\s+(\d+)/i)![1]!));
    if (/audited\s+(\d+)/i.test(t)) audited = Math.max(audited, parseInt(t.match(/audited\s+(\d+)/i)![1]!));
    if (/vulnerabilities/i.test(t)) {
      const vMatch = t.match(/(\d+)\s+vulnerabilit/i);
      if (vMatch) vulnerabilities = Math.max(vulnerabilities, parseInt(vMatch[1]!));
    }
    if (t.includes("up to date")) { inProgress = true; }
  }

  if (added === 0 && removed === 0 && changed === 0 && !inProgress) return null;

  const parts: string[] = [];
  if (inProgress && added === 0) parts.push("up to date");
  else {
    const counts: string[] = [];
    if (added > 0) counts.push(`+${added}`);
    if (removed > 0) counts.push(`-${removed}`);
    if (changed > 0) counts.push(`~${changed}`);
    parts.push(counts.join(" "));
    if (newPkgs.length > 0 && newPkgs.length <= 3) parts.push(`pkg: ${newPkgs.join(" ")}`);
    else if (newPkgs.length > 3) parts.push(`pkg: ${newPkgs.slice(0, 3).join(" ")} +${newPkgs.length - 3}`);
    if (audited > 0) parts.push(`audited:${audited}`);
    if (vulnerabilities > 0) parts.push(`vuln:${vulnerabilities}`);
  }

  const compressed = `[npm] ${parts.join(" | ")}`;
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "npm-install", compressed };
}

function compressCoverageLog(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const fileResults: string[] = [];
  let overallLine = "";

  for (const line of lines) {
    const t = line.trim();
    if (/All files\s*\|/.test(t) || /^\|\s*All files/i.test(t)) { overallLine = t; continue; }
    if (/^(File|Name)/.test(t) && t.includes("|")) { continue; }
    if (/^\|?\s*[\w./-]+\s*\|/.test(t)) {
      // Has a path/name followed by pipe and content with a number
      if (/\d+\.\d+|\d+%/.test(t)) {
        fileResults.push(t);
      }
    }
  }

  const result: string[] = [];
  const fileCount = fileResults.length;
  if (overallLine) {
    const overallPct = overallLine.match(/(\d+\.?\d*)%?/);
    result.push(`coverage: ${fileCount} files${overallPct ? `, overall ${overallPct[1]}%` : ""}`);
  } else {
    result.push(`coverage: ${fileCount} files`);
  }

  // Show lowest-coverage files first
  fileResults.sort((a, b) => {
    const ap = a.match(/(\d+\.\d+)%?/);
    const bp = b.match(/(\d+\.\d+)%?/);
    return (ap ? parseFloat(ap[1]!) : 100) - (bp ? parseFloat(bp[1]!) : 100);
  });

  for (const fr of fileResults.slice(0, 5)) {
    result.push(`  ${fr.trim().slice(0, 120)}`);
  }
  if (fileResults.length > 5) result.push(`  ... +${fileResults.length - 5} more files`);

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "coverage-log", compressed };
}

export function compressByType(raw: string, maxLines: number, explicitType?: OutputType): OutputTypeResult | null {
  if (!raw || raw.length < 80) return null;
  const type = explicitType ?? detectOutputType(raw);

  switch (type) {
    case "build-log": return compressBuildLog(raw, maxLines);
    case "source-code": return compressSourceCode(raw, maxLines);
    case "compiler-diagnostics": return compressCompilerDiagnostics(raw, maxLines);
    case "test-output": return compressTestOutput(raw, maxLines);
    case "coverage-log": return compressCoverageLog(raw, maxLines);
    case "npm-install": return compressNpmInstall(raw, maxLines);
    case "dep-tree": return compressDepTree(raw, maxLines);
    case "log-stream": return compressLogStream(raw, maxLines);
    case "config-content": return compressConfigContent(raw, maxLines);
    case "raw-text": return compressRawText(raw, maxLines);
  }
}
