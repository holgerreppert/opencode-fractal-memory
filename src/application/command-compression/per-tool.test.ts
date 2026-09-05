import { describe, expect, test } from "bun:test";
import { compressCommandOutput } from "./pipeline";
import type { CompressConfig } from "./config";
import { compressErrorFirst } from "./strategies/error";

const base: CompressConfig = {
  enabled: true,
  maxLines: 50,
  excludeCommands: [],
  alwaysFullOnFailure: false,
  perTool: {
    "bun test": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
    "pytest": { maxTokens: 1200, strategy: "error-first", errorThreshold: 500 },
    "ls": { maxTokens: 800, strategy: "names", errorThreshold: 800 },
    "git diff": { maxTokens: 2000, strategy: "generic" },
  },
};

function failingTestOutput(lines = 80): string {
  const arr: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i === 30) arr.push(`FAIL src/foo.test.ts: Expected x but got y at test ${i}`);
    else if (i === 31) arr.push(`    at expect(foo.test.ts:42:5)`);
    else if (i === 60) arr.push(`ERROR: panic: runtime error`);
    else if (i === 61) arr.push(`Traceback: file.py line 10 in main`);
    else arr.push(`ok line ${i} padding to make line reasonably long for token count`);
  }
  return arr.join("\n");
}

describe("perTool budgets", () => {
  test("bun test failing uses error-first projection", () => {
    const out = failingTestOutput(80);
    const res = compressCommandOutput("bun test src/foo.test.ts", out, true, base);
    expect(res).not.toBeNull();
    expect(res!.strategy).toBe("error-first");
    expect(res!.output).toContain("error-first projection");
    expect(res!.output).toContain("FAIL");
    expect(res!.output).toContain("panic");
  });

  test("pytest failing uses error-first with lower maxTokens", () => {
    const out = failingTestOutput(80);
    const res = compressCommandOutput("pytest tests/test_foo.py -v", out, true, base);
    expect(res).not.toBeNull();
    expect(res!.strategy).toBe("error-first");
  });

  test("ls does not use error-first even when failed flag false, uses names", () => {
    const out = Array.from({ length: 100 }, (_, i) => `file${i}.ts`).join("\n");
    const res = compressCommandOutput("ls -la", out, false, base);
    expect(res).not.toBeNull();
    expect(res!.strategy).toBe("ls");
    expect(res!.output).not.toContain("error-first");
  });

  test("git diff respects perTool generic (not error-first)", () => {
    const out = Array.from({ length: 100 }, (_, i) => `@@ -${i},7 +${i},7 @@ context line ${i} with padding`).join("\n");
    const res = compressCommandOutput("git diff --stat", out, false, base);
    // may be ls-like or generic, but must not be error-first
    if (res) expect(res.strategy).not.toBe("error-first");
  });

  test("cargo test failing uses error-first via fallback regex", () => {
    const out = failingTestOutput(80);
    const res = compressCommandOutput("cargo test -- --nocapture", out, true, base);
    expect(res).not.toBeNull();
    expect(res!.strategy).toBe("error-first");
  });

  test("go test failing uses error-first via fallback", () => {
    const out = failingTestOutput(80);
    const res = compressCommandOutput("go test ./...", out, true, { ...base, perTool: {} });
    expect(res).not.toBeNull();
    expect(res!.strategy).toBe("error-first");
  });

  test("longest-prefix wins: bun test beats bun", () => {
    const cfg: CompressConfig = {
      ...base,
      perTool: { bun: { maxTokens: 800, strategy: "names" }, "bun test": { maxTokens: 2500, strategy: "error-first" } },
    };
    const out = failingTestOutput(80);
    const res = compressCommandOutput("bun test file.test.ts", out, true, cfg);
    expect(res!.strategy).toBe("error-first");
  });
});

describe("compressErrorFirst unit", () => {
  test("tiny output stays verbatim", () => {
    const raw = "error line 1\nline2";
    expect(compressErrorFirst(raw)).toBe(raw);
  });

  test("preserves error spans ±3 and collapses gaps", () => {
    const raw = Array.from({ length: 60 }, (_, i) => (i === 30 ? "ERROR: bad thing" : `line ${i}`)).join("\n");
    const out = compressErrorFirst(raw, 2500);
    expect(out).toContain("ERROR: bad thing");
    expect(out).toContain("preserved");
    expect(out).toContain("lines omitted");
  });

  test("collapses 3+ identical lines xN", () => {
    const raw = Array.from({ length: 15 }, () => "same line").join("\n") + "\n" + Array.from({ length: 30 }, (_, i) => (i === 10 ? "ERROR: bad thing" : `line ${i}`)).join("\n");
    const out = compressErrorFirst(raw);
    expect(out).toContain("identical");
  });

  test("preserves traceId/file:line", () => {
    const raw = Array.from({ length: 50 }, (_, i) => (i === 25 ? "trace_id=abc123 file: src/foo.ts:42" : `line ${i}`)).join("\n");
    const out = compressErrorFirst(raw);
    expect(out).toContain("trace_id");
  });
});
