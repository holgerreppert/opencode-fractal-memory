import { describe, expect, test } from "bun:test";
import { CodeGraph } from "./graph";
import { extractFile, flattenStructure } from "./extract";
import { getFileContext } from "./query";

function span(startLine: number): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  return { startLine, startColumn: 0, endLine: startLine + 1, endColumn: 1 };
}

function item(partial: {
  kind: string;
  name?: string | undefined;
  startLine?: number;
  children?: unknown[];
}): unknown {
  return {
    kind: partial.kind,
    name: partial.name,
    span: span(partial.startLine ?? 0),
    children: (partial.children ?? []) as never[],
  };
}

describe("flattenStructure", () => {
  test("collects top-level declarations", () => {
    const structure = [
      item({ kind: "function_declaration", name: "hasGraph", startLine: 9 }),
      item({ kind: "function_declaration", name: "createGraphSearchHintHandler", startLine: 21 }),
    ];
    const out: { name: string; kind: string; line: number }[] = [];
    flattenStructure(structure as never[], 0, out);
    expect(out).toEqual([
      { name: "hasGraph", kind: "function_declaration", line: 10 },
      { name: "createGraphSearchHintHandler", kind: "function_declaration", line: 22 },
    ]);
  });

  test("ignores nested arrow-function parameters (depth > 0)", () => {
    // tree-sitter reports arrow callbacks with their parameter name
    // (`.filter(n => ...)` → name "n"). These must NOT pollute the graph.
    const structure = [
      item({
        kind: "function_declaration",
        name: "hasGraph",
        startLine: 9,
        children: [
          item({ kind: "arrow_function", name: "n", startLine: 51 }),
          item({ kind: "arrow_function", name: "m", startLine: 54 }),
        ],
      }),
    ];
    const out: { name: string; kind: string; line: number }[] = [];
    flattenStructure(structure as never[], 0, out);
    expect(out).toEqual([
      { name: "hasGraph", kind: "function_declaration", line: 10 },
    ]);
    expect(out.some(d => d.name === "n" || d.name === "m")).toBe(false);
  });

  test("ignores deeply nested items at any depth", () => {
    const structure = [
      item({
        kind: "class_declaration",
        name: "Foo",
        startLine: 1,
        children: [
          item({
            kind: "method_definition",
            name: "bar",
            startLine: 3,
            children: [
              item({ kind: "arrow_function", name: "p", startLine: 4 }),
            ],
          }),
        ],
      }),
    ];
    const out: { name: string; kind: string; line: number }[] = [];
    flattenStructure(structure as never[], 0, out);
    expect(out).toEqual([{ name: "Foo", kind: "class_declaration", line: 2 }]);
  });
});

describe("extractFile placeholder symbols", () => {
  const wasmMod = {
    availableLanguages: () => ["typescript"],
    process: (_source: string, _config: Record<string, unknown>) => ({
      language: "typescript",
      structure: [
        {
          kind: "function_declaration",
          name: "main",
          span: span(0),
          children: [],
          signature: "function main(",
          bodySpan: undefined,
        },
        {
          kind: "function_declaration",
          name: "helper",
          span: span(5),
          children: [],
          signature: "function helper(",
          bodySpan: undefined,
        },
      ],
      symbols: [
        { name: "main", kind: "function", span: span(0) },
        { name: "helper", kind: "function", span: span(5) },
      ],
      imports: [],
      free: () => {},
    }),
  };

  test("does not create kind=unknown line=0 placeholder symbols for callees", () => {
    const g = new CodeGraph();
    const source = `function main() { helper(); }\nfunction helper() {}\n`;
    extractFile("src/a.ts", source, wasmMod as never, g);

    const unknownPlaceholders: { id: string; label: string }[] = [];
    g.graph.forEachNode((id, attrs) => {
      const n = attrs as { type: string; kind?: string; line?: number; label: string };
      if (n.type === "symbol" && (n.kind === "unknown" || n.line === 0)) {
        unknownPlaceholders.push({ id, label: n.label });
      }
    });
    expect(unknownPlaceholders).toEqual([]);
  });

  test("getFileContext returns only real symbols with real kinds and lines", () => {
    const g = new CodeGraph();
    const source = `function main() { helper(); }\nfunction helper() {}\n`;
    extractFile("src/a.ts", source, wasmMod as never, g);

    const ctx = getFileContext(g, "src/a.ts");
    expect(ctx).not.toBeNull();
    const names = ctx!.symbols.map(s => s.name).sort();
    expect(names).toEqual(["helper", "main"]);
    for (const sym of ctx!.symbols) {
      expect(sym.kind).not.toBe("unknown");
      expect(sym.line).toBeGreaterThan(0);
    }
  });

  test("call edges target the existing symbol node, not a duplicate", () => {
    const g = new CodeGraph();
    const source = `function main() { helper(); }\nfunction helper() {}\n`;
    extractFile("src/a.ts", source, wasmMod as never, g);

    // Exactly one symbol node named "helper" (no unknown/line-0 duplicate).
    const helpers: string[] = [];
    g.graph.forEachNode((id, attrs) => {
      const n = attrs as { type: string; label: string };
      if (n.type === "symbol" && n.label === "helper") helpers.push(id);
    });
    expect(helpers).toHaveLength(1);
  });
});
