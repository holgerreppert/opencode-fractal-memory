import { describe, expect, test } from "bun:test";
import { compressLs } from "./command-compression/strategies/ls";
import { compressTestOutput } from "./command-compression/strategies/test";
import { compressGrep } from "./command-compression";
import { compressGeneric, compressRelevantGeneric } from "./command-compression/strategies/generic";
import { compressRawText, detectOutputType, compressByType } from "./command-compression/output-types";
import { classifyShape, applyShapeCompression } from "./command-compression/shape";
import { compressCommandOutput, type CompressConfig } from "./command-compression";
import { tryDeltaCompression, updateDeltaCache } from "./command-compression/delta";
import { addContentDedup, trigramJaccard } from "./command-compression/dedup";
import { smartFilter, scoreLine, applyWordAbbreviations, estimateTokens } from "./command-compression/utils";

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
  test("keeps listing verbatim when under keepNames", () => {
    const input = ["file1.ts", "file2.ts", "dir1/", "dir2/", "Makefile"].join("\n");
    expect(compressLs(input)).toBe(input);
  });

  test("returns raw when empty", () => {
    expect(compressLs("")).toBe("");
  });

  test("handles single file", () => {
    expect(compressLs("README.md")).toBe("README.md");
  });

  test("handles single dir", () => {
    expect(compressLs("src/")).toBe("src/");
  });

  test("strips total prefix but keeps names", () => {
    const input = "total 128\ndir1/\nfile1.ts";
    expect(compressLs(input)).toBe(input);
  });

  test("keeps first keepNames names, summarizes the rest", () => {
    const input = Array.from({ length: 60 }, (_, i) => i % 2 === 0 ? `file${i}.ts` : `dir${i}/`).join("\n");
    const result = compressLs(input, 10);
    expect(result).toContain("file0.ts");
    expect(result).toContain("… +50 more");
    expect(result).not.toContain("60 files");
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
  test("delegates to compressByType for compressible input", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const result = compressGeneric(lines.join("\n"), 6);
    expect(result).not.toBe(lines.join("\n"));
    expect(result).toContain("[kept");
    expect(result).toContain("line 0");
    expect(result).toContain("line 19");
  });

  test("truncates with head + tail when exceeding maxLines via compressRawText", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const raw = compressRawText(lines.join("\n"), 6);
    expect(raw).not.toBeNull();
    const resultLines = raw!.compressed.split("\n");
    expect(resultLines.length).toBeLessThanOrEqual(7); // header + 6 kept lines
    expect(raw!.compressed).toContain("[kept");
    expect(raw!.compressed).toContain("line 0");
    expect(raw!.compressed).toContain("line 19");
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

  test("detects consistent aligned table", () => {
    const input = [
      "CONTAINER ID   IMAGE     STATUS",
      "abc123def456   nginx     Up 2 hours",
      "def456abc789   redis     Up 5 days",
    ].join("\n");
    expect(classifyShape(input)).toBe("table");
  });

  test("rejects ragged output as table", () => {
    const input = [
      "short line",
      "a much longer line that has different token counts than the others here",
      "tiny",
    ].join("\n");
    expect(classifyShape(input)).not.toBe("table");
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

  test("ls strategy keeps names beyond verbatim threshold", () => {
    const output = Array.from({ length: 200 }, (_, i) => i % 2 === 0 ? `file${i}.ts` : `dir${i}/`).join("\n");
    const result = compressCommandOutput("ls -la", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("ls");
    expect(result!.output).toContain("file0.ts");
    expect(result!.output).toContain("… +");
  });

  test("small ls output passes through verbatim", () => {
    const output = Array.from({ length: 5 }, (_, i) => `file${i}.ts`).join("\n");
    const result = compressCommandOutput("ls -la", output, false, defaultConfig);
    expect(result).toBeNull();
  });

  test("test strategy", () => {
    const output = Array.from({ length: 45 }, () => "✓ some passing test with a long enough name to hit 80 chars").concat(["45 tests run"]).join("\n");
    const result = compressCommandOutput("npm test", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("test");
  });

  test("grep strategy keeps matched lines, not counts", () => {
    const output = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts:${i + 1}:export const someFunctionName = () => {}`).join("\n");
    const result = compressCommandOutput("rg something", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("grep");
    expect(result!.output).toContain("src/file0.ts:1:");
    expect(result!.output).toContain("matches across");
    expect(result!.output).toContain("… ");
  });

  test("git status strategy keeps changed-file list", () => {
    const lines = ["On branch main", "Changes not staged:"];
    for (let i = 0; i < 55; i++) lines.push(`  modified: src/file${i}.ts`);
    const output = lines.join("\n");
    const result = compressCommandOutput("git status", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("git-status");
    expect(result!.output).toContain("src/file0.ts");
    expect(result!.output).toContain("src/file49.ts");
    expect(result!.output).not.toContain("55 unstaged");
  });

  test("small git status passes through verbatim", () => {
    const output = ["On branch main", "Changes not staged:", "  modified: src/a.ts"].join("\n");
    const result = compressCommandOutput("git status", output, false, defaultConfig);
    expect(result).toBeNull();
  });

  test("generic fallback only for output beyond benign threshold", () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`line ${i}`);
    const result = compressCommandOutput("npm run build", lines.join("\n"), false, defaultConfig);
    expect(result).toBeNull();
  });

  test("generic fallback compresses huge clean output", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1100; i++) lines.push(`line ${i} with some padding text to make each line reasonably long`);
    const result = compressCommandOutput("npm run build", lines.join("\n"), false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("truncate");
  });

  test("net-win gate: rejects compression that saves too few tokens", () => {
    const output = Array.from({ length: 45 }, (_, i) => `src/f${i}.ts:${i + 1}:const x = ${i}`).join("\n");
    const strictConfig = { ...defaultConfig, netWinMinTokens: 10_000 };
    const result = compressCommandOutput("rg something", output, false, strictConfig);
    expect(result).toBeNull();
  });

  test("size guard: rejects compression that makes output bigger", () => {
    const output = "src/a.ts\nsrc/b.ts";
    const result = compressCommandOutput("rg --count foo", output, false, defaultConfig);
    expect(result).toBeNull();
  });

  test("pipelines: extracts prefix before pipe for strategy matching", () => {
    const output = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts:${i + 1}:export const fn = () => {}`).join("\n");
    const result = compressCommandOutput("rg something 2>&1 | tail -5", output, false, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("grep");
  });
});

describe("compressGrep", () => {
  test("keeps matches verbatim when under keepMatches", () => {
    const output = [
      "src/a.ts:1:const x = 1",
      "src/a.ts:5:const y = 2",
      "src/a.ts:10:const w = 0",
      "src/b.ts:3:const z = 3",
    ].join("\n");
    const result = compressGrep(output);
    expect(result).toBe(output);
  });

  test("keeps first keepMatches matched lines verbatim, then counts", () => {
    const output = Array.from({ length: 30 }, (_, i) => `src/a.ts:${i + 1}:const line${i} = ${i}`).join("\n");
    const result = compressGrep(output, 10);
    expect(result).toContain("const line0 = 0");
    expect(result).toContain("const line9 = 9");
    expect(result).toContain("30 matches across 1 files");
    expect(result).toContain("… ");
  });

  test("does not garble non-grep output (ps-style lines with colons)", () => {
    const output = [
      "awahe 77916996 1229920 pts/0 Sl+ 11:03:24 0:00 ps aux",
      "awahe 74052996 26616 pts/0 Sl+ 11:03:25 0:00 grep foo",
    ].join("\n");
    const result = compressGrep(output);
    expect(result).toBe(output);
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

describe("smartFilter", () => {
  test("strips npm deprecation warnings", () => {
    const output = "npm warn deprecated package@1.0.0: use v2\nreal content\nsome output";
    expect(smartFilter(output)).toBe("real content\nsome output");
  });

  test("strips spinner characters", () => {
    const output = "⠋ installing\n⠹ progress\nreal result";
    expect(smartFilter(output)).toBe("real result");
  });

  test("strips progress bars", () => {
    const output = "[====>      ] 45%\nreal output here";
    expect(smartFilter(output)).toBe("real output here");
  });

  test("strips git hints", () => {
    const output = "hint: your branch is up to date\nOn branch main\nreal output";
    expect(smartFilter(output)).toBe("On branch main\nreal output");
  });

  test("strips log timestamps", () => {
    const output = "[2026-06-24T12:00:00] some log line\nthe data we want";
    expect(smartFilter(output)).toBe("some log line\nthe data we want");
  });

  test("passes through clean output unchanged", () => {
    const output = "file1.ts\nfile2.ts\ndir/";
    expect(smartFilter(output)).toBe(output);
  });
});

describe("scoreLine", () => {
  test("signal words score +5", () => {
    const score = scoreLine("ERROR: connection refused", [], 10, 20);
    expect(score).toBeGreaterThanOrEqual(5);
  });

  test("head lines get bias up to +4", () => {
    expect(scoreLine("line 0", [], 0, 20)).toBeGreaterThan(scoreLine("line 0", [], 10, 20));
  });

  test("tail lines get +1 bias", () => {
    expect(scoreLine("tail", [], 18, 20)).toBeGreaterThan(scoreLine("middle", [], 10, 20));
  });

  test("blank lines penalized -1", () => {
    expect(scoreLine("   ", [], 10, 20)).toBe(-1);
  });
});

describe("compressRelevantGeneric", () => {
  test("keeps error signal lines from middle of output via compressRawText", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `ok line ${i}`);
    lines[10] = "ERROR: connection refused";
    lines[15] = "error: out of memory";
    const result = compressRelevantGeneric(lines.join("\n"), 10, "run test");
    expect(result).toContain("ERROR: connection refused");
    expect(result).toContain("error: out of memory");
  });

  test("preserves original line order from compressRawText", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const result = compressRelevantGeneric(lines.join("\n"), 6, "some command");
    const output = result.split("\n");
    // Skip the [kept ...] header
    const dataLines = output.filter(l => !l.startsWith("[kept") && !l.startsWith("[relevant"));
    const nums = dataLines.map(l => parseInt(l.match(/\d+/)?.[0] ?? "0"));
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]!).toBeGreaterThan(nums[i - 1]!);
    }
  });

  test("returns raw under maxLines", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line ${i}`);
    expect(compressRelevantGeneric(lines.join("\n"), 10, "cmd")).toBe(lines.join("\n"));
  });
});

describe("detectOutputType — new structural shapes", () => {
  test("detects compiler diagnostics", () => {
    const input = [
      "src/a.ts:10:5: error TS2345: Type 'X' is not assignable to type 'Y'",
      "src/a.ts:15:3: warning TS1000: Unused variable",
      "src/b.ts:1:1: error TS111: Cannot find module 'z'",
    ].join("\n");
    expect(detectOutputType(input)).toBe("compiler-diagnostics");
  });

  test("detects test output", () => {
    const input = "✓ basic test passes\n✗ failing test broke\nTests: 1 failed, 1 passed";
    expect(detectOutputType(input)).toBe("test-output");
  });

  test("detects npm install output", () => {
    const input = "npm install react\n+ react@18.2.0\n+ lodash@4.17.21\nadded 2 packages\nnpm audit";
    expect(detectOutputType(input)).toBe("npm-install");
  });

  test("detects coverage log", () => {
    const input = ["File          | % Stmts | % Branch | % Funcs | % Lines",
      "All files     |     85.5 |     72.3 |    90.1 |   85.5",
      "src/foo.ts    |    100.0 |     80.0 |   100.0 |  100.0",
      "src/bar.ts    |     50.0 |      0.0 |   100.0 |   50.0",
    ].join("\n");
    expect(detectOutputType(input)).toBe("coverage-log");
  });

  test("falls back to raw-text for plain build errors without build-pattern or diagnostics format", () => {
    const input = ["ERROR: build failed", "FAILURE in build step"].join("\n");
    expect(detectOutputType(input)).toBe("raw-text");
  });
});

describe("compressByType — compiler diagnostics", () => {
  test("groups diagnostics by file, shows errors first", () => {
    const input = [
      "src/a.ts:10:5: error TS2345: Type 'X' is not assignable to type 'Y'",
      "src/a.ts:15:3: warning TS1000: Unused variable 'z'",
      "src/a.ts:22:1: error TS1800: File is a CommonJS module but no 'export' statement",
      "src/b.ts:1:1: error TS111: Cannot find module 'z'",
      "src/b.ts:45:8: warning TS2322: Type 'string' is not assignable to type 'number'",
      "src/c.ts:3:3: error TS2339: Property 'foo' does not exist on type 'Bar'",
    ].join("\n");
    const result = compressByType(input, 50);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("compiler-diagnostics");
    expect(result!.compressed).toContain("3f");
    expect(result!.compressed).toContain("4e");
    expect(result!.compressed).toContain("2w");
    expect(result!.compressed).toContain("Type 'X'");
  });

  test("returns null when compression is not beneficial", () => {
    const result = compressByType("plain text without diagnostics", 50);
    expect(result).toBeNull();
  });
});

describe("compressByType — test output", () => {
  test("shows pass/fail summary", () => {
    const input = "✓ passing test one\n✓ passing test two\n✗ failing test three\nFAIL failing test four\n✗ failing test five\n✓ passing test six\nTests: 2 failed, 4 passed";
    const result = compressByType(input, 50);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("test-output");
    expect(result!.compressed).toContain("2 failed");
    expect(result!.compressed).toContain("failing test three");
    expect(result!.compressed).toContain("failing test four");
  });

  test("shows only suite-line when all pass", () => {
    const input = "✓ test one\n✓ test two\n✓ test three\n✓ test four\n✓ test five\n✓ test six\n✓ test seven\n✓ test eight\n10 passing";
    const result = compressByType(input, 50);
    expect(result).not.toBeNull();
    expect(result!.compressed).toContain("10 passing");
  });
});

describe("compressByType — npm install", () => {
  test("summarizes added packages", () => {
    const input = ["npm install", "+ react@18.2.0", "+ lodash@4.17.21", "+ express@4.18.2", "+ typescript@5.3.0", "added 4 packages", "changed 2 packages in 1.2s", "audited 1000 packages", "2 vulnerabilities"].join("\n");
    const result = compressByType(input, 50);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("npm-install");
    expect(result!.compressed).toContain("+4");
    expect(result!.compressed).toContain("audited");
  });

  test("returns null for output with no package changes", () => {
    const result = compressByType("some irrelevant output here", 50);
    expect(result).toBeNull();
  });
});

describe("compressByType — coverage log", () => {
  test("summarizes coverage with lowest-coverage files first", () => {
    const input = [
      "File          | % Stmts | % Branch",
      "All files     |     70.0 |     65.0",
      "src/bar.ts    |     50.0 |     40.0",
      "src/foo.ts    |    100.0 |    100.0",
      "src/baz.ts    |     60.0 |     55.0",
    ].join("\n");
    const result = compressByType(input, 50);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("coverage-log");
    expect(result!.compressed).toContain("70.0");
    expect(result!.compressed).toContain("3 files");
    const lines = result!.compressed.split("\n");
    expect(lines[1]).toMatch(/50\.0|bar/);
  });
});

describe("applyWordAbbreviations", () => {
  test("abbreviates bare words", () => {
    expect(applyWordAbbreviations("the configuration is under management")).toContain("config");
    expect(applyWordAbbreviations("the configuration is under management")).toContain("mgmt");
  });

  test("never rewrites tokens inside paths", () => {
    const input = "src/management/public/app.js";
    expect(applyWordAbbreviations(input)).toBe(input);
  });

  test("never rewrites tokens with extensions or colons", () => {
    expect(applyWordAbbreviations("import.meta.js https://example.com")).toBe("import.meta.js https://example.com");
  });
});

describe("estimateTokens", () => {
  test("empty input is 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("code-like text estimates more tokens per char than prose", () => {
    const code = "const x = (a) => { return a + 1; }";
    const prose = "hello world this is some prose text";
    expect(estimateTokens(code)).toBeGreaterThan(estimateTokens(prose));
  });

  test("never returns 0 for non-empty text", () => {
    expect(estimateTokens("a")).toBeGreaterThanOrEqual(1);
  });
});

describe("applyShapeCompression — table", () => {
  test("keeps table verbatim when rows fit keepRows", () => {
    const input = [
      "CONTAINER ID   IMAGE     STATUS",
      "abc123def456   nginx     Up 2 hours",
      "def456abc789   redis     Up 5 days",
    ].join("\n");
    const result = applyShapeCompression(input, 50, 20);
    expect(result).toBeNull();
  });

  test("compresses table beyond keepRows, keeping header and rows", () => {
    const lines = ["NAME     STATUS", ...Array.from({ length: 30 }, (_, i) => `svc${i}     Running`)];
    const input = lines.join("\n");
    const result = applyShapeCompression(input, 50, 10);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("shape-table");
    expect(result!.output).toContain("svc0");
    expect(result!.output).toContain("… +20 more rows");
  });
});
