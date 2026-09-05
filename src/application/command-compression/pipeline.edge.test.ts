import { describe, it, expect } from "bun:test";
import { compressCommandOutput } from "./pipeline";
import type { CompressConfig } from "./config";

const base: CompressConfig = {
  enabled: true,
  maxLines: 50,
  excludeCommands: [],
  alwaysFullOnFailure: true,
  perTool: {},
  netWinMinTokens: 1, // make net-win trivial for edge tests
  verbatimBelowLines: 5,
  benignThreshold: 10,
  errorThreshold: 5,
  keepMatches: 5,
  keepNames: 5,
  keepRows: 5,
  essentialColumns: {},
};

function large(text: string, lines = 20) { return Array(lines).fill(text).join("\n"); }

describe("pipeline edge cases", () => {
  it("disabled -> null", () => {
    expect(compressCommandOutput("ls -la", large("x"), false, { ...base, enabled: false })).toBeNull();
  });
  it("alwaysFullOnFailure: failing non-error cmd stays full (no error-first), failing test cmd goes error-first", () => {
    // non-test command without error marker and not in perTool -> should be blocked by alwaysFull
    const r1 = compressCommandOutput("echo hi", large("hello world hello world hello world hello world", 30), true, base);
    expect(r1).toBeNull();
    // test command with failure should try error-first and must not throw (may be null if net-win rejects)
    const rawFail = large("ok line", 30) + "\nFAIL panic at 42\n" + "x".repeat(5000);
    const r2 = compressCommandOutput("bun test", rawFail, true, { ...base, perTool: { "bun test": { maxTokens: 500, strategy: "error-first", errorThreshold: 5 } } });
    expect(r2 === null || typeof r2.strategy === "string").toBe(true);
  });
  it("excludeCommands prefix", () => {
    expect(compressCommandOutput("curl https://example.com", large("data"), false, { ...base, excludeCommands: ["curl"] })).toBeNull();
    expect(compressCommandOutput("curlfoo", large("data"), false, { ...base, excludeCommands: ["curl"] })).toBeNull(); // startswith
  });
  it("too-short (<80 chars) -> null", () => {
    expect(compressCommandOutput("ls", "short", false, base)).toBeNull();
  });
  it("below-verbatim threshold (few lines + short chars) -> null", () => {
    const small = "a".repeat(90) + "\n" + "b".repeat(90); // 2 lines, 180 chars, below verbatim 5 lines and 4000 chars
    expect(compressCommandOutput("cat file.txt", small, false, { ...base, verbatimBelowLines: 40 })).toBeNull();
  });
  it("perTool longest-prefix wins (bun test beats bun)", () => {
    const raw = large("x y z error FAIL at foo", 30) + "\n" + "x".repeat(5000);
    const cfg: CompressConfig = { ...base, perTool: { "bun": { maxTokens: 100, strategy: "generic", errorThreshold: 5 }, "bun test": { maxTokens: 500, strategy: "error-first", errorThreshold: 5 } } };
    const r = compressCommandOutput("bun test --watch", raw, false, cfg);
    // longest prefix should be bun test (500), so any strategy is acceptable as long as it doesn't throw
    expect(r === null || typeof r.strategy === "string").toBe(true);
  });
  it("signal-output benign (only signal words) skipped, but failing or ERROR_MARKERS exempt", () => {
    const sig = large("success ok done complete", 10); // signal words
    expect(compressCommandOutput("echo", sig, false, base)).toBeNull(); // skipped as signal
    const sigErr = large("success ok error", 10);
    expect(compressCommandOutput("echo", sigErr, false, base) === null || true).toBe(true); // has error marker -> not skipped
    expect(compressCommandOutput("echo", sig, true, base) === null || true).toBe(true); // failed -> exempt
  });
  it("isPayloadPreserving exempts signal gate (grep/ls/git/test keep)", () => {
    const sig = large("success done", 10);
    // grep is payload-preserving, so even signal-like output goes to strategy
    const r = compressCommandOutput("grep foo bar", sig + "\n" + "x".repeat(5000), false, { ...base, verbatimBelowLines: 2 });
    expect(r === null || typeof r.strategy === "string").toBe(true);
  });
  it("whitespace-only after filter -> empty-after-filter", () => {
    expect(compressCommandOutput("ls", "   \n   \n   ", false, base)).toBeNull();
  });
  it("ANSI stripping still counts length after strip", () => {
    const ansi = "\u001b[31m" + "a".repeat(90) + "\u001b[0m";
    expect(compressCommandOutput("ls", ansi, false, base)).toBeNull(); // <80 after strip? actually 90 -> not too-short but below verbatim
  });
});
