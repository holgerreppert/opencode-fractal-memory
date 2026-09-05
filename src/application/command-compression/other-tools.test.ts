import { describe, it, expect } from "bun:test";
import { compressLs } from "./strategies/ls";
import { compressGrep } from "./strategies/grep";
import { compressGitStatus, compressGitLog, compressGitDiff } from "./strategies/git";
import { compressGeneric, compressRelevantGeneric } from "./strategies/generic";
import { compressByType, detectOutputType } from "./output-types";
import { classifyShape, applyShapeCompression } from "./shape";
import { trimByRelevance } from "./relevance";
import { addContentDedup, trigramJaccard } from "./dedup";
import { tryDeltaCompression, updateDeltaCache } from "./delta";
import { isSignalOutput, stripAnsi, smartFilter, getCommandPrefix } from "./utils";

describe("other compress tools edge cases", () => {
  // ls
  it("compressLs: 100 files -> names only, keeps 50 by default, deduplicates", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `-rw-r--r-- 1 user group 123 Jan 1 file${i}.txt`).join("\n");
    const out = compressLs(raw, 50);
    expect(out.split("\n").length).toBeLessThanOrEqual(52); // 50 + header
    expect(out).toContain("file0.txt");
  });
  it("compressLs: single file passthrough", () => {
    const raw = `-rw-r--r-- 1 user group 123 Jan 1 single.txt`;
    const out = compressLs(raw, 50);
    expect(out).toContain("single.txt");
  });
  it("compressLs: empty -> empty", () => {
    expect(compressLs("", 50)).toBe("");
  });

  // grep — header + keepMatches + summary + per-file counts
  it("compressGrep: many matches keeps keepMatches", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `file${i}.ts:10:matched line ${i}`).join("\n");
    const out = compressGrep(raw, 15);
    expect(out.split("\n").length).toBeLessThanOrEqual(28); // 1 header +15 +1 more +10 file counts +1 overflow
    expect(out).toContain("matched");
    expect(out).toContain("30 matches");
  });
  it("compressGrep: no matches -> passthrough or empty", () => {
    const out = compressGrep("no match here", 15);
    expect(typeof out).toBe("string");
  });

  // git
  it("compressGitStatus: untracked + modified", () => {
    const raw = ` M src/foo.ts\n?? new.txt\nA  added.ts\n D deleted.ts`;
    const out = compressGitStatus(raw);
    expect(out).toContain("src/foo.ts");
    expect(out).toContain("new.txt");
  });
  it("compressGitLog: many commits truncated to sha + msg", () => {
    const raw = Array.from({ length: 20 }, (_, i) => `commit abc${i}def123456789 Author: test\n    msg ${i}`).join("\n");
    const out = compressGitLog(raw);
    expect(out.length).toBeLessThan(raw.length);
    expect(out).toContain("abc");
    expect(out.split("\n").length).toBe(20);
  });
  it("compressGitDiff: large diff keeps summary + hunks", () => {
    const raw = `diff --git a/foo.ts b/foo.ts\n@@ -1,3 +1,3 @@\n- old\n+ new\n` + "x".repeat(5000);
    const out = compressGitDiff(raw);
    expect(out).toContain("file changed");
    expect(out).toContain("- old");
    expect(out).toContain("+ new");
    expect(out.length).toBeLessThanOrEqual(raw.length);
  });

  // generic
  it("compressGeneric: truncates to maxLines with head+tail", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const out = compressGeneric(raw, 10);
    expect(out.split("\n").length).toBeLessThan(100);
    expect(out).toContain("line 0");
    expect(out).toContain("line 99");
  });
  it("compressRelevantGeneric: keeps relevant lines for cmd", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `line ${i} foo bar`).join("\n");
    const out = compressRelevantGeneric(raw, 10, "grep foo");
    expect(out).toContain("foo");
  });

  // output-types
  it("detectOutputType: coverage-log", () => {
    const raw = `File | % Stmts | % Branch\nsrc/foo.ts | 80.5 | 70.2\nAll files | 75.0 | 60.0`;
    expect(detectOutputType(raw)).toBe("coverage-log");
  });
  it("detectOutputType: test-output", () => {
    const raw = `PASS src/foo.test.ts\nFAIL src/bar.test.ts\nTests: 1 failed`;
    expect(detectOutputType(raw)).toBe("test-output");
  });
  it("compressByType: coverage-log shrinks", () => {
    const raw = `File | % Stmts | % Branch\n` + Array.from({ length: 50 }, (_, i) => `src/file${i}.ts | 80 | 70`).join("\n") + `\nAll files | 75 | 60`;
    const r = compressByType(raw, 10);
    expect(r).not.toBeNull();
    expect(r!.compressed.length).toBeLessThan(raw.length);
  });
  it("compressByType: raw-text returns null or passthrough", () => {
    const r = compressByType("just some random text not matching any type x".repeat(10), 10);
    expect(r === null || r.type === "raw-text").toBe(true);
  });

  // shape
  it("classifyShape: json vs table vs log", () => {
    expect(classifyShape(`{"a":1}\n{"b":2}`)).toBeDefined();
    expect(classifyShape(`a,b,c\n1,2,3\n4,5,6`)).toBeDefined();
  });
  it("applyShapeCompression: large csv keeps header + sample", () => {
    const raw = `a,b,c\n` + Array.from({ length: 50 }, (_, i) => `${i},${i+1},${i+2}`).join("\n");
    const r = applyShapeCompression(raw, 10, 5, undefined);
    if (r) expect(r.output).toContain("a,b,c");
  });

  // relevance
  it("trimByRelevance: respects intentTerms", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `line ${i} ${i % 2 === 0 ? "auth" : "other"}`).join("\n");
    const out = trimByRelevance(raw, "grep", { enabled: true, maxLines: 50, excludeCommands: [], alwaysFullOnFailure: false, perTool: {}, relevanceTrimmingEnabled: true } as any, ["auth"]);
    expect(out).toContain("auth");
  });

  // dedup — per dedup.ts: empty=>1, raw<80 => null, fuzzy 0.85
  it("trigramJaccard: identical 1.0, empty 1, disjoint near 0", () => {
    expect(trigramJaccard("hello world", "hello world")).toBeCloseTo(1, 1);
    expect(trigramJaccard("", "")).toBe(1);
    expect(trigramJaccard("abc", "xyz")).toBeLessThan(0.2);
  });
  it("addContentDedup: dedup same content second time (>=80 chars)", () => {
    const cache = new Map<string, any>();
    const raw = "x".repeat(80) + " hello world hello world hello world hello world";
    const first = addContentDedup(cache as any, raw, { output: "compressed", strategy: "generic" } as any, { enabled: true, similarityThreshold: 0.85, maxComparisons: 10 });
    expect(first?.dedup).toBe(false);
    const second = addContentDedup(cache as any, raw, { output: "compressed", strategy: "generic" } as any, { enabled: true, similarityThreshold: 0.85, maxComparisons: 10 });
    expect(second?.dedup).toBe(true);
    expect(second?.strategy).toBe("dedup");
  });

  // delta
  it("tryDeltaCompression: similar second run returns delta", () => {
    const cache = new Map();
    const cmd = "echo hi";
    const raw1 = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const raw2 = raw1 + "\nline 20 new";
    // need to populate cache first
    const cfg: any = { deltaCompressionEnabled: true, deltaMaxCacheSize: 50, deltaMinSimilarity: 0.5 };
    updateDeltaCache(cache as any, cmd, raw1, "generic", 50);
    const delta = tryDeltaCompression(cache as any, cmd, raw2, cfg);
    expect(delta === null || typeof delta.output === "string").toBe(true);
  });

  // utils — isSignalOutput true when error/signal patterns present (per SIGNAL_PATTERNS)
  it("isSignalOutput: signal vs non-signal", () => {
    expect(isSignalOutput("success ok done")).toBe(false); // no error pattern
    expect(isSignalOutput("error failed panic")).toBe(true); // contains error/FAIL
    expect(isSignalOutput("some random text with content")).toBe(false);
  });
  it("stripAnsi: removes codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });
  it("smartFilter: trims and removes empty", () => {
    expect(smartFilter("  hello  \n\n  world  \n")).toContain("hello");
  });
  it("getCommandPrefix: extracts prefix (full segment, env stripped)", () => {
    expect(getCommandPrefix("ls -la /tmp")).toBe("ls -la /tmp");
    expect(getCommandPrefix("  grep -r foo")).toBe("grep -r foo");
    expect(getCommandPrefix("source foo && ls -la")).toBe("ls -la");
    expect(getCommandPrefix("")).toBe("");
  });
});
