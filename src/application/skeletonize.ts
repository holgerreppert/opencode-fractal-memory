import { createRequire } from "node:module";

type WasmNode = {
  kind(): string;
  startByte(): number;
  endByte(): number;
  startPosition(): { row: number; column: number };
  endPosition(): { row: number; column: number };
  childCount(): number;
  namedChildCount(): number;
  child(index: number): WasmNode | undefined;
  namedChild(index: number): WasmNode | undefined;
  childByFieldName(name: string): WasmNode | undefined;
  isNamed(): boolean;
  isExtra(): boolean;
  isError(): boolean;
  isMissing(): boolean;
  hasError(): boolean;
  parent(): WasmNode | undefined;
  free(): void;
};

type WasmTree = {
  rootNode(): WasmNode;
  free(): void;
};

type WasmParser = {
  setLanguage(name: string): void;
  parse(source: string): WasmTree | undefined;
  free(): void;
};

type WasmModule = {
  availableLanguages(): string[];
  getParser(name: string): WasmParser;
  detectLanguageFromExtension(ext: string): string | undefined;
  hasLanguage(name: string): boolean;
};

let wasmMod: WasmModule | null = null;

function getWasm(): WasmModule {
  if (!wasmMod) {
    const req = createRequire(import.meta.url);
    wasmMod = req("@kreuzberg/tree-sitter-language-pack-wasm") as WasmModule;
  }
  return wasmMod;
}

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

function nodeKindIsDef(kind: string): boolean {
  return (
    kind.endsWith("_declaration") ||
    kind.endsWith("_definition") ||
    kind.endsWith("_item") ||
    kind.endsWith("_spec") ||
    kind === "method_definition" ||
    kind === "arrow_function" ||
    kind === "generator_function" ||
    kind === "generator_function_declaration" ||
    kind === "constructor_declaration" ||
    kind === "method_signature" ||
    kind === "abstract_method_signature" ||
    kind === "call_signature" ||
    kind === "construct_signature" ||
    kind === "index_signature" ||
    kind === "property_signature" ||
    kind === "variable_declarator" ||
    kind === "module_declaration" ||
    kind === "function_type" ||
    kind === "field_definition" ||
    kind === "property_definition"
  );
}

function nodeKindIsImport(kind: string): boolean {
  return (
    kind === "import_statement" ||
    kind === "import_declaration" ||
    kind === "require_function" ||
    kind === "using_declaration" ||
    kind === "use_declaration" ||
    kind === "mod_item" ||
    kind === "include_statement" ||
    kind === "include_directive" ||
    kind === "package_declaration" ||
    kind === "require_call"
  );
}

function nodeName(node: WasmNode, source: string): string {
  const byField = node.childByFieldName("name");
  if (byField) {
    const s = byField.startByte();
    const e = byField.endByte();
    const n = source.slice(s, e);
    byField.free();
    return n;
  }
  for (let i = 0; i < node.namedChildCount(); i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    const ck = child.kind();
    if (ck === "identifier" || ck === "property_identifier" || ck === "type_identifier") {
      const s = child.startByte();
      const e = child.endByte();
      const n = source.slice(s, e);
      child.free();
      return n;
    }
    child.free();
  }
  return "";
}

function collectDefNodes(node: WasmNode, source: string, depth: number, result: { depth: number; name: string; line: number }[], _isRoot: boolean = false) {
  const kind = node.kind();
  if (nodeKindIsImport(kind)) return;

  if (depth > 0 && nodeKindIsDef(kind)) {
    const name = nodeName(node, source);
    const line = node.startPosition().row + 1;
    if (name) {
      result.push({ depth, name, line });
    }
  }

  const childDepth = depth + 1;

  for (let i = 0; i < node.namedChildCount(); i++) {
    const child = node.namedChild(i);
    if (child) {
      collectDefNodes(child, source, childDepth, result);
      child.free();
    }
  }
}

function collectImportLines(node: WasmNode, source: string): string[] {
  const lines: string[] = [];

  function walk(n: WasmNode, depth: number) {
    const k = n.kind();
    if (nodeKindIsImport(k) && depth <= 2) {
      const s = n.startByte();
      const e = n.endByte();
      const text = source.slice(s, e).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      if (text && text.length > 0 && text.length < 200) lines.push(text);
    }
    if (depth > 4) return;
    for (let i = 0; i < n.namedChildCount(); i++) {
      const child = n.namedChild(i);
      if (child) {
        walk(child, depth + 1);
        child.free();
      }
    }
  }
  walk(node, 0);
  return dedupeImports(lines);
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

const REGEX_PATTERNS: Record<string, RegExp> = {
  ts: /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|abstract\s+class|abstract\s+interface)\s+(\w+)/gm,
  js: /^(export\s+)?(default\s+)?(async\s+)?(function|class)\s+(\w+)/gm,
  py: /^(async\s+)?(def|class)\s+(\w+)/gm,
  rs: /^(pub(\s*\(.*?\))?\s+)?(fn|struct|enum|trait|impl|type|const|static|union|macro_rules!)\s+(\w+)/gm,
  go: /^(func\s+\w+|type\s+\w+\s+(struct|interface))/gm,
  java: /^(public|private|protected)?\s*(static|abstract|final|sealed|non-sealed)?\s*(class|interface|enum|record)\s+(\w+)/gm,
  rb: /^(def|class|module)\s+(\w+)/gm,
  php: /^(function|class|interface|trait|enum)\s+(\w+)/gm,
};

function regexSkeleton(filePath: string, source: string): string | null {
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : "";
  let pattern: RegExp | null = null;
  for (const [key, re] of Object.entries(REGEX_PATTERNS)) {
    if (ext === `.${key}` || ext === key) {
      pattern = re;
      break;
    }
  }
  if (!pattern) return null;

  const matches: { name: string; line: number }[] = [];
  const re = new RegExp(pattern.source, "gm");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const line = source.slice(0, match.index).split("\n").length;
    const sig = match[0].trim();
    matches.push({ name: sig, line });
  }

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
  const mod = getWasm();
  if (!mod.hasLanguage(lang)) return null;

  const parser = mod.getParser(lang);
  if (!parser) return null;
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  if (!tree) {
    parser.free();
    return null;
  }

  const root = tree.rootNode();

  const defs: { depth: number; name: string; line: number }[] = [];
  collectDefNodes(root, source, 0, defs);

  const importLines = collectImportLines(root, source);

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

  tree.free();
  parser.free();

  if (output.length <= 2) return null;
  return output.join("\n");
}

export function extractSkeleton(filePath: string, content: string): string | null {
  if (!content || content.length < 100) return null;

  const lang = langFromExt(filePath);
  if (!lang) return null;

  try {
    const astResult = astSkeleton(content, lang);
    if (astResult) return astResult;
  } catch {
    // fall through to regex
  }

  return regexSkeleton(filePath, content);
}
