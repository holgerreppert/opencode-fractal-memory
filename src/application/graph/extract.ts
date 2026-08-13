import { readFileSync } from "node:fs";
import type { CodeGraph } from "./graph";
import { memLog } from "../../logging";

// Types for the wasm-bindgen generated classes
interface WasmProcessResult {
  readonly language: string;
  readonly structure: WasmStructureItem[];
  readonly symbols: WasmSymbolInfo[];
  readonly imports: WasmImportInfo[];
  free(): void;
}

interface WasmStructureItem {
  readonly kind: string;
  readonly name: string | undefined;
  readonly span: WasmSpan;
  readonly children: WasmStructureItem[];
  readonly signature: string | undefined;
  readonly bodySpan: WasmSpan | undefined;
}

interface WasmSymbolInfo {
  readonly name: string;
  readonly kind: string;
  readonly span: WasmSpan;
}

interface WasmImportInfo {
  readonly source: string;
  readonly items: string[];
  readonly isWildcard: boolean;
  readonly alias: string | undefined;
}

interface WasmSpan {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export type WasmModule = {
  availableLanguages(): string[];
  process(source: string, config: Record<string, unknown>): WasmProcessResult;
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "jsx", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".pyi": "python",
  ".rs": "rust", ".go": "go", ".java": "java",
  ".rb": "ruby", ".php": "php",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp",
  ".cs": "c-sharp", ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".lua": "lua", ".dart": "dart", ".zig": "zig",
  ".sql": "sql", ".r": "r",
  ".ex": "elixir", ".exs": "elixir",
  ".hs": "haskell", ".tf": "hcl",
  ".proto": "protobuf", ".toml": "toml",
  ".vue": "vue", ".svelte": "svelte", ".astro": "astro",
};

const WASM_LANGS = new Set([
  "bash", "c", "cpp", "csharp", "css", "dockerfile", "elixir", "erlang",
  "go", "haskell", "html", "java", "javascript", "json", "kotlin", "lua",
  "markdown", "php", "python", "ruby", "rust", "scala", "shell", "sql",
  "svelte", "swift", "toml", "tsx", "typescript", "vue", "yaml", "zig",
]);

function langFromExt(filePath: string): string | null {
  const base = filePath.split("/").pop() ?? filePath;
  if (base.includes(".")) {
    const dot = base.lastIndexOf(".");
    if (dot !== -1) {
      const ext = base.slice(dot).toLowerCase();
      const lang = EXT_TO_LANG[ext];
      if (lang && WASM_LANGS.has(lang)) return lang;
    }
  }
  return null;
}

function extractModulePath(text: string): string | null {
  const m = text.match(/from\s+["']([^"']+)["']/);
  if (m?.[1]) return m[1];
  const rm = text.match(/require\(["']([^"']+)["']\)/);
  if (rm?.[1]) return rm[1];
  const pm = text.match(/^(?:from\s+)?(\S+)\s+(?:import\b)/);
  if (pm?.[1] && pm[1] !== "import") {
    // Python: import os, import numpy as np
    return null;
  }
  // Python: import os (the source IS the module name)
  if (text.startsWith("import ")) {
    const parts = text.slice(7).trim().split(/\s+/);
    return parts[0] || null;
  }
  return null;
}

interface FlatDef {
  name: string;
  kind: string;
  line: number;
}

// Only top-level declarations (depth 0) become symbols. Nested arrow functions /
// callbacks are reported by tree-sitter with their parameter name (e.g.
// `.some(p => …)` → name "p"), which pollutes the graph with single-letter
// noise like `Function l [line 5]`.
export function flattenStructure(items: WasmStructureItem[], depth: number, out: FlatDef[]): void {
  for (const item of items) {
    if (item.name && depth === 0) {
      out.push({ name: item.name, kind: item.kind, line: item.span.startLine + 1 });
    }
    if (item.children && item.children.length > 0) {
      flattenStructure(item.children, depth + 1, out);
    }
  }
}

function extractRegexCallees(source: string, localNames: Set<string>): Set<string> {
  const callees = new Set<string>();
  const re = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  const skip = new Set([
    "if", "for", "while", "switch", "catch", "function", "class",
    "typeof", "instanceof", "new", "delete", "void", "return", "throw",
    "yield", "await", "import", "export", "super", "this",
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    if (name && !skip.has(name) && localNames.has(name)) {
      callees.add(name);
    }
  }
  return callees;
}

function extractRegexTypes(source: string, localNames: Set<string>): Set<string> {
  const types = new Set<string>();
  const re = /\b([A-Z][a-zA-Z0-9_$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    if (name && localNames.has(name)) {
      types.add(name);
    }
  }
  return types;
}

let _extTotal = 0;
let _extNoLang = 0;
let _extProcessFailed = 0;
let _extUnsupported = 0;
let _extSuccess = 0;

export function extractFile(
  filePath: string,
  content: string,
  wasmMod: WasmModule,
  graph: CodeGraph,
): void {
  _extTotal++;
  const lang = langFromExt(filePath);
  if (!lang) {
    _extNoLang++;
    graph.addFile(filePath);
    return;
  }

  const fileId = graph.addFile(filePath);

  let result: WasmProcessResult | undefined;
  try {
    result = wasmMod.process(content, {
      language: lang,
      structure: true,
      symbols: true,
      imports: true,
    });
  } catch {
    _extProcessFailed++;
    return;
  }

  const defs: FlatDef[] = [];
  flattenStructure(result.structure, 0, defs);

  for (const sym of result.symbols) {
    if (sym.name && !defs.some(d => d.name === sym.name)) {
      defs.push({ name: sym.name, kind: sym.kind, line: sym.span.startLine + 1 });
    }
  }

  for (const d of defs) {
    const symId = graph.addSymbol(filePath, d.name, d.kind, d.line);
    graph.addEdge(symId, fileId, "defined_in");
  }

  const localNames = new Set(defs.map(d => d.name));
  const callees = extractRegexCallees(content, localNames);
  const types = extractRegexTypes(content, localNames);

  // Callees/types are filtered to localNames above, so they always reference an
  // existing def. Look them up and reuse the def node — creating placeholder
  // symbols with kind "unknown" / line 0 pollutes the graph (and the read
  // preamble) with duplicate nodes like `unknown hasGraph [line 0]`.
  const defByName = new Map(defs.map(d => [d.name, d]));

  for (const d of defs) {
    const fromId = graph.addSymbol(filePath, d.name, d.kind, d.line);
    for (const callee of callees) {
      if (callee !== d.name) {
        const target = defByName.get(callee);
        if (!target) continue;
        const toId = graph.addSymbol(filePath, target.name, target.kind, target.line);
        graph.addCall(fromId, toId);
      }
    }
    for (const t of types) {
      if (t !== d.name) {
        const target = defByName.get(t);
        if (!target) continue;
        const toId = graph.addSymbol(filePath, target.name, target.kind, target.line);
        graph.addReferences(fromId, toId);
      }
    }
  }

  for (const imp of result.imports) {
    const source = extractModulePath(imp.source);
    if (!source || (!source.startsWith(".") && !source.startsWith("/"))) continue;
    const importeeId = graph.addFile(source);
    for (const d of defs) {
      const fromId = graph.addSymbol(filePath, d.name, d.kind, d.line);
      graph.addImport(fromId, importeeId);
    }
  }

  _extSuccess++;
  try {
    result.free();
  } catch {
    // cleanup failure — ignore
  }
}

export function freeParsers(): void {
  // no-op: process() API manages its own parsers internally
}

export function logExtractDiagnostics(): void {
  const count = _extNoLang + _extProcessFailed + _extSuccess;
  memLog("info", "graph-extract", "diagnostics", {
    total: _extTotal,
    counted: count,
    noLang: _extNoLang,
    processFailed: _extProcessFailed,
    success: _extSuccess,
    extractErrors: _extTotal - count,
  });
}

export function resetExtractDiagnostics(): void {
  _extTotal = 0;
  _extNoLang = 0;
  _extProcessFailed = 0;
  _extUnsupported = 0;
  _extSuccess = 0;
}

export function extractFromFile(filePath: string, graph: CodeGraph, wasmMod: WasmModule): void {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return;
  }
  if (content.length < 100) return;
  extractFile(filePath, content, wasmMod, graph);
}

export { langFromExt, EXT_TO_LANG };
