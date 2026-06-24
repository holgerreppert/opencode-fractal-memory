import { describe, expect, test } from "bun:test";
import { compressLs } from "./compress-output/strategies/ls";
import { compressTestOutput } from "./compress-output/strategies/test";
import { compressGrep } from "./compress-output";
import { compressGeneric } from "./compress-output/strategies/generic";
import { classifyShape, applyShapeCompression } from "./compress-output/shape";
import { compressCommandOutput, type CompressConfig } from "./compress-output";
import { tryDeltaCompression, updateDeltaCache } from "./compress-output/delta";
import { addContentDedup, trigramJaccard } from "./compress-output/dedup";

const defaultConfig: CompressConfig = {
  enabled: true,
  maxLines: 50,
  excludeCommands: ["curl", "wget"],
  alwaysFullOnFailure: true,
  fuzzyDedupEnabled: true,
  fuzzyDedupThreshold: 0.85,
  fuzzyDedupMax: 50,
};

describe("compressLs", () => {
  test("summarizes file listing", () => {
    const input = ["file1.ts", "file2.ts", "dir1/", "dir2/", "Makefile"].join("\n");
    expect(compressLs(input)).toBe("2 dirs, 3 files");
  });

  test("returns raw when empty", () => {
    expect(compressLs("")).toBe("");
  });

  test("handles single file", () => {
    expect(compressLs("README.md")).toBe("1 file");
  });

  test("handles single dir", () => {
    expect(compressLs("src/")).toBe("1 dir");
  });

  test("strips total prefix", () => {
    const input = "total 128\ndir1/\nfile1.ts";
    expect(compressLs(input)).toBe("1 dir, 1 file");
  });
});

describe("compressTestOutput", () => {
  test("summarizes all pass", () => {
    const input = ["✓ test passes", "✓ another passes", "2 passed"].join("\n");
    expect(compressTestOutput(input)).toBe("2/2 passed");
  });

  test("lists failures", () => {
    const input = ["✓ pass one", "FAIL test broken", "✗ another fail", "3 tests run"].join("\n");
    const result = compressTestOutput(input);
    expect(result).toContain("2 tests failed");
    expect(result).toContain("test broken");
    expect(result).toContain("another fail");
  });

  test("returns raw when no test patterns", () => {
    expect(compressTestOutput("some random output")).toBe("some random output");
  });

  test("handles empty", () => {
    expect(compressTestOutput("")).toBe("");
  });
});

describe("compressGeneric", () => {
  test("deduplicates consecutive identical lines", () => {
    const input = ["a", "b", "b", "b", "c"].join("\n");
    expect(compressGeneric(input, 50)).toBe(["a", "b (×3)", "c"].join("\n"));
  });

  test("truncates with head + tail when exceeding maxLines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) lines.push(`line ${i}`);
    const result = compressGeneric(lines.join("\n"), 6);
    const resultLines = result.split("\n");
    expect(resultLines.length).toBeLessThan(20);
    expect(result).toContain("truncated");
    expect(result).toContain("line 0");
    expect(result).toContain("line 19");
  });

  test("returns raw when under maxLines with no dupes", () => {
    const input = ["a", "b", "c"].join("\n");
    expect(compressGeneric(input, 50)).toBe(input);
  });

  test("handles empty", () => {
    expect(compressGeneric("", 50)).toBe("");
  });
});

describe("classifyShape", () => {
  test("detects JSON object", () => {
    expect(classifyShape('{"a":1,"b":2}')).toBe("json");
  });

  test("detects JSON array", () => {
    expect(classifyShape('[1,2,3]')).toBe("json");
  });

  test("detects CSV", () => {
    expect(classifyShape("a,b,c\n1,2,3\n4,5,6")).toBe("csv");
  });

  test("detects stack trace", () => {
    expect(classifyShape("TypeError: x is not a function\n    at Foo.bar (/src/file.ts:10:5)")).toBe("stack-trace");
  });

  test("returns unknown for plain text", () => {
    expect(classifyShape("hello world\nsome text")).toBe("unknown");
  });

  test("detects stack trace with File:line format", () => {
    expect(classifyShape('  File "/src/file.py", line 42, in main')).toBe("stack-trace");
  });
});

describe("applyShapeCompression", () => {
  test("compresses large JSON object", () => {
    const input = JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12 });
    const result = applyShapeCompression(input, 50);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("shape-json");
    expect(result!.output).toContain("Object");
  });

  test("compresses large JSON array", () => {
    const input = JSON.stringify(Array.from({ length: 50 }, (_, i) => i));
    const result = applyShapeCompression(input, 50);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("shape-json");
    expect(result!.output).toContain("Array(50)");
  });

  test("returns null for unknown shape", () => {
    expect(applyShapeCompression("plain text\nstill plain", 50)).toBeNull();
  });
});

describe("compressCommandOutput", () => {
  test("returns null when disabled", () => {
    const result = compressCommandOutput("ls", "file1\nfile2", false, { ...defaultConfig, enabled: false });
    expect(result).toBeNull();
  });

  test("returns null for excluded commands", () => {
    const result = compressCommandOutput("curl https://example.com", '{"ok":true}', false, defaultConfig);
    expect(result).toBeNull();
  });

  test("returns null on failure with alwaysFullOnFailure", () => {
    const result = compressCommandOutput("ls", "file1\nfile2", true, defaultConfig);
    expect(result).toBeNull();
  });

  test("returns null for short output", () => {
    const result = compressCommandOutput("ls", "short", false, defaultConfig);
    expect(result).toBeNull();
  });

  test("ls strategy", () => {
    const output = Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? `file${i}.ts` : `dir${i}/`).join("\n");
    const result = compressCommandOutput("ls -la", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("ls");
  });

  test("test strategy", () => {
    const output = Array.from({ length: 10 }, () => "✓ some passing test with a long enough name to hit 80 chars").concat(["10 tests run"]).join("\n");
    const result = compressCommandOutput("npm test", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("test");
  });

  test("grep strategy", () => {
    const output = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts:${i + 1}:export const someFunctionName = () => {}`).join("\n");
    const result = compressCommandOutput("rg something", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("grep");
  });

  test("git status strategy", () => {
    const output = ["On branch main", "Changes not staged:", "  modified: src/a.ts", "  modified: src/b.ts", "  modified: src/c.ts", "Untracked files:", "  src/d.ts"].join("\n");
    const result = compressCommandOutput("git status", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("git-status");
  });

  test("generic fallback for long output", () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`line ${i}`);
    const result = compressCommandOutput("npm run build", lines.join("\n"), false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("truncate");
  });

  test("size guard: rejects compression that makes output bigger", () => {
    const output = "src/a.ts\nsrc/b.ts";
    const result = compressCommandOutput("rg --count foo", output, false, defaultConfig);
    expect(result).toBeNull();
  });

  test("pipelines: extracts prefix before pipe for strategy matching", () => {
    const output = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts:${i + 1}:export const fn = () => {}`).join("\n");
    const result = compressCommandOutput("rg something 2>&1 | tail -5", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("grep");
  });
});

describe("compressGrep", () => {
  test("regular grep output groups by file", () => {
    const output = [
      "src/a.ts:1:const x = 1",
      "src/a.ts:5:const y = 2",
      "src/a.ts:10:const w = 0",
      "src/b.ts:3:const z = 3",
    ].join("\n");
    const result = compressGrep(output);
    expect(result).toContain("4 matches across 2 files");
    expect(result).toContain("src/a.ts: 3 matches");
    expect(result).toContain("src/b.ts: 1 match");
  });

  test("rg --count output is passed through unchanged", () => {
    const output = [
      "src/tools/test.ts:12",
      "src/management/routes.ts:8",
      "src/storage/sqlite.ts:5",
    ].join("\n");
    const result = compressGrep(output);
    expect(result).toBe(output);
  });

  test("returns raw when compression would be bigger", () => {
    const output = [
      "src/a.ts:1",
      "src/b.ts:1",
      "src/c.ts:1",
    ].join("\n");
    const result = compressGrep(output);
    expect(result).toBe(output);
  });
});

describe("tryDeltaCompression", () => {
  test("returns null when disabled", () => {
    const config = { ...defaultConfig, deltaCompressionEnabled: false };
    expect(tryDeltaCompression(new Map(), "echo hi", "output", config)).toBeNull();
  });

  test("returns null on first run (no cache)", () => {
    expect(tryDeltaCompression(new Map(), "echo hi", "output", defaultConfig)).toBeNull();
  });

  test("detects unchanged output", () => {
    const cache = new Map();
    updateDeltaCache(cache, "echo hi", "hello world", "generic");
    const result = tryDeltaCompression(cache, "echo hi", "hello world", defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.output).toContain("unchanged");
  });

  test("generates delta for changed output", () => {
    const cache = new Map();
    const longLines = Array.from({ length: 20 }, (_, i) => `This is line number ${i} of the output with some padding to make each line reasonably long`).join("\n");
    updateDeltaCache(cache, "big command", longLines, "generic");
    const changed = longLines.replace("line number 15", "line number 99");
    const result = tryDeltaCompression(cache, "big command", changed, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.output).toContain("Δ");
    expect(result!.strategy).toBe("delta");
  });
});

describe("addContentDedup", () => {
  test("returns null for short output", () => {
    expect(addContentDedup(new Map(), "echo", "short", null)).toBeNull();
  });

  test("detects exact duplicate by hash", () => {
    const cache = new Map();
    const long = "x".repeat(100);
    const first = addContentDedup(cache, "cmd", long, { output: "compressed", strategy: "generic" });
    expect(first).not.toBeNull();
    expect(first!.dedup).toBe(false);

    const second = addContentDedup(cache, "cmd", long, null);
    expect(second).not.toBeNull();
    expect(second!.dedup).toBe(true);
    expect(second!.strategy).toBe("dedup");
  });
});

describe("trigramJaccard", () => {
  test("identical strings have similarity 1", () => {
    expect(trigramJaccard("hello world", "hello world")).toBe(1);
  });

  test("empty strings have similarity 1", () => {
    expect(trigramJaccard("", "")).toBe(1);
  });

  test("completely different strings have low similarity", () => {
    expect(trigramJaccard("aaaaa", "bbbbb")).toBeLessThan(0.3);
  });

  test("similar strings have high similarity", () => {
    const sim = trigramJaccard("hello world foo bar", "hello world foo baz");
    expect(sim).toBeGreaterThan(0.5);
  });
});
