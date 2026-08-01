import type { OutputType } from "./types";

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
