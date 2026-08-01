import { createRequire } from "node:module";

type WasmProcessResult = {
  readonly language: string;
  readonly structure: WasmStructureItem[];
  readonly symbols: WasmSymbolInfo[];
  readonly imports: WasmImportInfo[];
  free(): void;
};

type WasmStructureItem = {
  readonly kind: string;
  readonly name: string | undefined;
  readonly span: WasmSpan;
  readonly children: WasmStructureItem[];
  readonly signature: string | undefined;
  readonly bodySpan: WasmSpan | undefined;
};

type WasmSymbolInfo = {
  readonly name: string;
  readonly kind: string;
  readonly span: WasmSpan;
};

type WasmImportInfo = {
  readonly source: string;
  readonly items: string[];
  readonly isWildcard: boolean;
  readonly alias: string | undefined;
};

type WasmSpan = {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".cs": "c-sharp",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".css": "css",
  ".html": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".sql": "sql",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".r": "r",
  ".dart": "dart",
  ".zig": "zig",
  ".elm": "elm",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".ex": "elixir",
  ".exs": "elixir",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".tf": "hcl",
  ".tfvars": "hcl",
  ".proto": "protobuf",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".sass": "sass",
  ".scss": "scss",
  ".less": "less",
  ".dockerfile": "dockerfile",
  ".mk": "make",
  ".cmake": "cmake",
  ".toml": "toml",
};

function langFromExt(filePath: string): string | null {
  const base = filePath.split("/").pop() ?? filePath;
  if (base.includes(".")) {
    const dot = base.lastIndexOf(".");
    if (dot !== -1) {
      const ext = base.slice(dot).toLowerCase();
      if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
    }
  }
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  if (base.toLowerCase() === "makefile") return "make";
  if (base.toLowerCase() === "cmakelists.txt") return "cmake";
  return null;
}

function dedupeImports(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter(l => {
    const key = l.replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const REGEX_PATTERNS: Record<string, RegExp[]> = {
  ts: [
    /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum)\s+(\w+)/gm,
    /^\s{2,}((private|protected|public|static|abstract|readonly|override)\s+)*(async\s+)?(\w+)\s*\([^;{]*\)\s*[:{]/gm,
  ],
  js: [
    /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class)\s+(\w+)/gm,
    /^\s{2,}((static|async|get|set)\s+)?(\w+)\s*\([^;{]*\)\s*[{]/gm,
  ],
  py: [
    /^\s*(async\s+)?(def|class)\s+(\w+)/gm,
  ],
  rs: [
    /^\s*(pub(\s*\(.*?\))?\s+)?(fn|struct|enum|trait|impl|type|const|static|union|macro_rules!)\s+(\w+)/gm,
  ],
  go: [
    /^\s*(func\s+\w+|type\s+\w+\s+(struct|interface))/gm,
  ],
  java: [
    /^\s*(public|private|protected)?\s*(static|abstract|final|sealed|non-sealed)?\s*(class|interface|enum|record)\s+(\w+)/gm,
    /^\s{2,}((public|private|protected|static|abstract|final)\s+)*\w+\s*\([^;{]*\)\s*[{]/gm,
  ],
  rb: [
    /^\s*(def|class|module)\s+(\w+)/gm,
  ],
  php: [
    /^\s*(function|class|interface|trait|enum)\s+(\w+)/gm,
    /^\s{2,}((public|private|protected|static|abstract)\s+)*function\s+(\w+)/gm,
  ],
};

function regexSkeleton(filePath: string, source: string): string | null {
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : "";
  let patterns: RegExp[] | null = null;
  for (const [key, re] of Object.entries(REGEX_PATTERNS)) {
    if (ext === `.${key}` || ext === key) {
      patterns = re;
      break;
    }
  }
  if (!patterns) return null;

  const seen = new Set<string>();
  const matches: { name: string; line: number }[] = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, "gm");
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const line = source.slice(0, match.index).split("\n").length;
      const sig = match[0].trim();
      const key = `${sig}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ name: sig, line });
    }
  }
  matches.sort((a, b) => a.line - b.line);

  if (matches.length === 0) return null;

  const totalLines = source.split("\n").length;
  const output: string[] = [
    `# Skeleton (regex) — ${totalLines} lines → ${matches.length} symbols`,
    "",
    "# symbols",
  ];
  for (const m of matches) {
    output.push(`  ${m.name} [line ${m.line}]`);
  }
  return output.join("\n");
}

function astSkeleton(source: string, lang: string): string | null {
  let wasmMod: any;
  try {
    const req = createRequire(import.meta.url);
    const resolved = req.resolve("@kreuzberg/tree-sitter-language-pack-wasm");
    if (req.cache?.[resolved]) delete req.cache[resolved];
    wasmMod = req("@kreuzberg/tree-sitter-language-pack-wasm");
  } catch (e) {
    throw new Error(`fresh WASM load failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!wasmMod || typeof wasmMod.process !== "function") {
    throw new Error(`fresh WASM load returned ${wasmMod ? "module without process()" : "null/undefined"}`);
  }
  let result: WasmProcessResult;
  try {
    result = wasmMod.process(source, {
      language: lang,
      structure: true,
      symbols: true,
      imports: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = (e as Error)?.stack?.split("\n").slice(0, 4).join(" ");
    throw new Error(`WASM process() failed for ${lang}: ${msg} ${stack || ""}`);
  }

  try {
    const defs: { depth: number; name: string; line: number }[] = [];

    function walk(items: WasmStructureItem[], depth: number): void {
      for (const item of items) {
        // Only top-level symbols (depth 0) are collected. Nested arrow
        // functions / callbacks are reported by tree-sitter with their
        // parameter name (e.g. `.some(p => …)` → name "p"), which pollutes
        // the skeleton with single-letter noise. Depth 0 items are the real
        // module-level declarations.
        if (item.name && depth === 0) {
          defs.push({ depth, name: item.name, line: item.span.startLine + 1 });
        }
        if (item.children && item.children.length > 0) {
          walk(item.children, depth + 1);
        }
      }
    }

    walk(result.structure, 0);

    const importLines = dedupeImports(
      result.imports.map(imp => imp.source).filter((s): s is string => !!s),
    );

    const totalLines = source.split("\n").length;
    const output: string[] = [];

    const reductionPct = totalLines > 0
      ? Math.round((1 - (importLines.length + defs.length + 2) / totalLines) * 100)
      : 0;
    output.push(`# Skeleton: ${lang} (${totalLines} lines → ${defs.length} symbols, ~${reductionPct}% reduction)`);

    if (importLines.length > 0) {
      output.push("");
      if (importLines.length <= 15) {
        output.push("# imports");
        for (const imp of importLines) output.push(`  ${imp}`);
      } else {
        output.push(`# imports: ${importLines.length} statements`);
      }
    }

    if (defs.length > 0) {
      output.push("");
      output.push("# symbols");
      for (const d of defs) {
        const indent = "  ".repeat(Math.min(d.depth, 4));
        output.push(`${indent}${d.name} [line ${d.line}]`);
      }
    }

    if (output.length <= 2) return null;
    return output.join("\n");
  } finally {
    result.free();
  }
}

export function extractSkeleton(filePath: string, content: string, _debug?: boolean): string | null {
  if (!content || content.length < 100) return null;

  const lang = langFromExt(filePath);
  if (!lang) return null;

  let astError: string | null = null;
  try {
    const astResult = astSkeleton(content, lang);
    if (astResult) return astResult;
    astError = "AST returned null (unsupported language in WASM?)";
  } catch (e) {
    astError = e instanceof Error ? e.message : String(e);
  }

  const regexResult = regexSkeleton(filePath, content);
  if (regexResult && astError) {
    return `# Skeleton (regex) — fallback (AST failed: ${astError})\n${regexResult}`;
  }
  return regexResult;
}
