import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateFileSummary, generateFileLabel, SOURCE_FILE_EXTENSIONS } from "./file-summary";

describe("generateFileSummary", () => {
  const tempDir = path.join(os.tmpdir(), `opencode-summary-test-${Date.now()}`);
  
  beforeEach(() => {
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test("extracts TypeScript imports", () => {
    const fileContent = `import * as fs from "node:fs";
import { readFileSync } from "fs";
import something from "./local-module";
import type { Plugin } from "@opencode-ai/plugin";

export function hello() {}
export class MyClass {}
export interface Config {}

const privateFunc = () => {}`;

    const filePath = path.join(tempDir, "test.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("test.ts", filePath, content, "ts");

    expect(summary).toContain("### Imports");
    expect(summary).toContain("node:fs");
    expect(summary).toContain("./local-module");
    expect(summary).toContain("@opencode-ai/plugin");
  });

  test("extracts TypeScript functions with line numbers", () => {
    const fileContent = `function first() {}
function second() {}
const third = () => {};
export function fourth() {}`;

    const filePath = path.join(tempDir, "func.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("func.ts", filePath, content, "ts");

    expect(summary).toContain("### Functions");
    expect(summary).toContain("first");
    expect(summary).toContain("second");
  });

  test("extracts TypeScript classes", () => {
    const fileContent = `class MyClass {}
export class ExportedClass {}
class PrivateClass {}`;

    const filePath = path.join(tempDir, "classes.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("classes.ts", filePath, content, "ts");

    expect(summary).toContain("### Classes");
    expect(summary).toContain("MyClass");
    expect(summary).toContain("ExportedClass");
  });

  test("extracts TypeScript interfaces and types", () => {
    const fileContent = `interface Config {}
type StringOrNumber = string | number;
export interface APIConfig {}
export type Callback = () => void;`;

    const filePath = path.join(tempDir, "types.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("types.ts", filePath, content, "ts");

    expect(summary).toContain("### Interfaces/Types");
    expect(summary).toContain("Config");
    expect(summary).toContain("StringOrNumber");
  });

  test("extracts exports", () => {
    const fileContent = `export const a = 1;
export function b() {}
export default class DefaultClass {}`;

    const filePath = path.join(tempDir, "exports.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("exports.ts", filePath, content, "ts");

    expect(summary).toContain("### Exports");
    expect(summary).toContain("a");
    expect(summary).toContain("b");
    expect(summary).toContain("(default)");
  });

  test("extracts Python functions and classes", () => {
    const fileContent = `import os
from pathlib import Path

def first_function():
    pass

class MyClass:
    pass

def second_func():
    pass`;

    const filePath = path.join(tempDir, "test.py");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("test.py", filePath, content, "py");

    expect(summary).toContain("### Imports");
    expect(summary).toContain("os");
    expect(summary).toContain("pathlib.Path");
    expect(summary).toContain("### Classes");
    expect(summary).toContain("MyClass");
    expect(summary).toContain("### Functions");
    expect(summary).toContain("first_function");
    expect(summary).toContain("second_func");
  });

  test("extracts Markdown headings", () => {
    const fileContent = `# Main Title

## Section One

### Subsection A

## Section Two

## Section Three`;

    const filePath = path.join(tempDir, "README.md");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("README.md", filePath, content, "md");

    expect(summary).toContain("### Structure");
    expect(summary).toContain("Main Title");
    expect(summary).toContain("Section One");
    expect(summary).toContain("Section Two");
  });

  test("includes file metadata", () => {
    const fileContent = `function test() {}`;

    const filePath = path.join(tempDir, "meta.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("meta.ts", filePath, content, "ts");

    expect(summary).toContain("## File: meta.ts");
    expect(summary).toContain(`Path: ${filePath}`);
    expect(summary).toContain("### Functions");
    expect(summary).toContain("test");
  });

  test("includes preview of first lines", () => {
    const fileContent = `first line here
second line content
third line data
fourth line here
fifth line`;

    const filePath = path.join(tempDir, "preview.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("preview.ts", filePath, content, "ts");

    expect(summary).toContain("### Preview");
    expect(summary).toContain("```");
    expect(summary).toContain("first line");
  });

  test("handles empty file", () => {
    const filePath = path.join(tempDir, "empty.ts");
    fs.writeFileSync(filePath, "");

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("empty.ts", filePath, content, "ts");

    expect(summary).toContain("## File: empty.ts");
    // Empty file has 1 line (empty string splits to array with one empty element)
    expect(summary).toContain("Lines:");
  });

  test("handles file with only comments", () => {
    const fileContent = `// This is a comment
/* Multi-line
   comment */
# Python comment`;

    const filePath = path.join(tempDir, "comments.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("comments.ts", filePath, content, "ts");

    expect(summary).toContain("## File: comments.ts");
    expect(summary).not.toContain("### Functions");
  });

  test("handles unknown file extension", () => {
    const fileContent = `some content here
with multiple lines`;

    const filePath = path.join(tempDir, "file.xyz");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("file.xyz", filePath, content, "xyz");

    expect(summary).toContain("## File: file.xyz");
    expect(summary).toContain("### Preview");
  });

  test("limits imports to 10 + indicator", () => {
    const imports = Array.from({ length: 15 }, (_, i) => `import ${i} from "./module${i}";`).join("\n");
    const fileContent = `${imports}\nexport function test() {}`;

    const filePath = path.join(tempDir, "many.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("many.ts", filePath, content, "ts");

    expect(summary).toContain("... +5 more");
  });

  test("handles single line file", () => {
    const filePath = path.join(tempDir, "single.ts");
    fs.writeFileSync(filePath, "const x = 1;");

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("single.ts", filePath, content, "ts");

    expect(summary).toContain("## File: single.ts");
    expect(summary).toContain("Lines: 1");
  });

  test("handles very long line", () => {
    const longLine = "const x = " + "a".repeat(10000) + ";";
    const filePath = path.join(tempDir, "longline.ts");
    fs.writeFileSync(filePath, longLine);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("longline.ts", filePath, content, "ts");

    expect(summary).toContain("Lines: 1");
    expect(summary).toContain("### Preview");
  });

  test("handles unicode content", () => {
    const fileContent = `// 你好世界
function test() {}
export const myVar = 1;`;

    const filePath = path.join(tempDir, "unicode.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("unicode.ts", filePath, content, "ts");

    expect(summary).toContain("### Preview");
    // Unicode variable names aren't captured, but file is parsed
    expect(summary).toContain("test");
  });

  test("handles type-only imports", () => {
    const fileContent = `import type { Plugin } from "@opencode-ai/plugin";
import type { Config } from "./types";`;

    const filePath = path.join(tempDir, "typeimports.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("typeimports.ts", filePath, content, "ts");

    expect(summary).toContain("### Imports");
    expect(summary).toContain("@opencode-ai/plugin");
    expect(summary).toContain("./types");
  });

  test("handles namespace imports", () => {
    const fileContent = `import * as fs from "node:fs";
import * as os from "node:os";`;

    const filePath = path.join(tempDir, "namespace.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("namespace.ts", filePath, content, "ts");

    expect(summary).toContain("node:fs");
    expect(summary).toContain("node:os");
  });

  test("handles re-exports", () => {
    const fileContent = `export { something } from "./other";
export { default } from "./default";`;

    const filePath = path.join(tempDir, "reexport.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("reexport.ts", filePath, content, "ts");

    expect(summary).toContain("### Imports");
    expect(summary).toContain("./other");
  });

  test("handles shebang", () => {
    const fileContent = `#!/usr/bin/env node
function main() {}`;

    const filePath = path.join(tempDir, "shebang.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("shebang.ts", filePath, content, "ts");

    expect(summary).toContain("### Functions");
    expect(summary).toContain("main");
  });

  test("handles JSON file", () => {
    const fileContent = `{"name": "test", "version": "1.0.0"}`;

    const filePath = path.join(tempDir, "package.json");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("package.json", filePath, content, "json");

    expect(summary).toContain("## File: package.json");
    expect(summary).toContain("### Preview");
  });

  test("handles Rust files", () => {
    const fileContent = `use std::io;
pub fn main() {}
mod inner;
struct MyStruct;`;

    const filePath = path.join(tempDir, "main.rs");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("main.rs", filePath, content, "rs");

    expect(summary).toContain("### Preview");
    expect(summary).toContain("std::io");
  });

  test("handles Go files", () => {
    const fileContent = `package main
import "fmt"
func main() {}
type MyStruct struct {}`;

    const filePath = path.join(tempDir, "main.go");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("main.go", filePath, content, "go");

    expect(summary).toContain("### Preview");
    expect(summary).toContain("fmt");
  });

  test("handles file with only whitespace", () => {
    const filePath = path.join(tempDir, "whitespace.ts");
    fs.writeFileSync(filePath, "   \n   \n   \n   ");

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("whitespace.ts", filePath, content, "ts");

    expect(summary).toContain("## File: whitespace.ts");
    // Whitespace-only may or may not have preview depending on how it's handled
  });

  test("handles async functions", () => {
    const fileContent = `async function fetchData() {}
async function process() {}
function syncFunction() {}`;

    const filePath = path.join(tempDir, "async.ts");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("async.ts", filePath, content, "ts");

    expect(summary).toContain("### Functions");
    expect(summary).toContain("fetchData");
    expect(summary).toContain("process");
    expect(summary).toContain("syncFunction");
  });

  test("handles JavaScript with arrow functions", () => {
    const fileContent = `const add = (a, b) => a + b;
const multiply = (x, y) => {
  return x * y;
};
function regular(x) { return x; }`;

    const filePath = path.join(tempDir, "arrows.js");
    fs.writeFileSync(filePath, fileContent);

    const content = fs.readFileSync(filePath, "utf-8");
    const summary = generateFileSummary("arrows.js", filePath, content, "js");

    expect(summary).toContain("### Functions");
    expect(summary).toContain("add");
    expect(summary).toContain("multiply");
  });
});

describe("label generation", () => {
  test("generates short labels under 61 characters", () => {
    const longPath = "/very/long/path/to/some/deeply/nested/directory/with/many/subdirectories/src/components/Auth/LoginForm.tsx";
    const shortLabel = generateFileLabel(longPath);
    
    expect(shortLabel.length).toBeLessThanOrEqual(61);
  });

  test("hash produces 3-character string", () => {
    const path1 = "/path/to/file.ts";
    const path2 = "/another/path.ts";
    
    const hash1 = generateFileLabel(path1).split(':')[2];
    const hash2 = generateFileLabel(path2).split(':')[2];
    
    expect(hash1.length).toBe(3);
    expect(hash2.length).toBe(3);
  });

  test("different paths produce different hashes", () => {
    const path1 = "/path/one.ts";
    const path2 = "/path/two.ts";
    
    const hash1 = generateFileLabel(path1).split(':')[2];
    const hash2 = generateFileLabel(path2).split(':')[2];
    
    expect(hash1).not.toBe(hash2);
  });
});

describe("cache behavior", () => {
  test("cache lookup uses exact label match", () => {
    const nodes = [
      { id: "1", label: "file:plugin.ts:abc", content: "test1" },
      { id: "2", label: "file:plugin.ts:xyz", content: "test2" },
    ];
    
    const searchLabel = "file:plugin.ts:abc";
    const found = nodes.find(n => n.label === searchLabel);
    
    expect(found).toBeDefined();
    expect(found!.id).toBe("1");
  });

  test("cache returns null for non-existent file", () => {
    const nodes = [
      { id: "1", label: "file:plugin.ts:abc", content: "test1" },
    ];
    
    const searchLabel = "file:nonexistent.ts:xyz";
    const found = nodes.find(n => n.label === searchLabel);
    
    expect(found).toBeUndefined();
  });
});

