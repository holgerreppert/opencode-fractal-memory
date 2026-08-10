import { describe, expect, test } from "bun:test";
import { createToolBeforeGuardHandler, detectRgReplaceMisuse, rewriteRgReplaceMisuse, rgFootgunHint } from "./tool-before-guard";

describe("detectRgReplaceMisuse", () => {
  test("flags rg -rn as replace-with-n footgun", () => {
    expect(detectRgReplaceMisuse('rg -rn "loadHNSWIndexFromDisk" src/')).toBe("n");
  });

  test("flags rg -rln as replace-with-ln footgun", () => {
    expect(detectRgReplaceMisuse('rg -rln "rebuildHNSWIndex" src/ -g "*.ts"')).toBe("ln");
  });

  test("flags rg -rw", () => {
    expect(detectRgReplaceMisuse('rg -rw "foo" src/')).toBe("w");
  });

  test("flags combined flags before -r", () => {
    expect(detectRgReplaceMisuse('rg -i -rn "foo" src/')).toBe("n");
  });

  test("flags rg preceded by a cd prefix", () => {
    expect(detectRgReplaceMisuse('cd /repo && rg -rn "flattenStructure" src/ | head -2')).toBe("n");
  });

  test("flags rg with 2>/dev/null redirect after -r", () => {
    expect(detectRgReplaceMisuse('rg -rn "foo" src/ 2>/dev/null')).toBe("n");
  });

  test("does not flag rg -n (correct recursive+line-number usage)", () => {
    expect(detectRgReplaceMisuse('rg -n "foo" src/')).toBeNull();
  });

  test("does not flag rg with quoted --replace value", () => {
    expect(detectRgReplaceMisuse('rg -r "replacement" -l "foo" src/')).toBeNull();
  });

  test("does not flag plain grep", () => {
    expect(detectRgReplaceMisuse('grep -rn "foo" src/')).toBeNull();
  });

  test("does not flag rg --replace long form", () => {
    expect(detectRgReplaceMisuse('rg --replace n -l "foo" src/')).toBeNull();
  });

  test("does not flag rg preceded by cd when using -n", () => {
    expect(detectRgReplaceMisuse('cd /repo && rg -n "foo" src/')).toBeNull();
  });

  test("does not flag non-grep commands", () => {
    expect(detectRgReplaceMisuse("bun run dev")).toBeNull();
    expect(detectRgReplaceMisuse("")).toBeNull();
  });
});

describe("rewriteRgReplaceMisuse", () => {
  test("rewrites rg -rn to rg -n", () => {
    expect(rewriteRgReplaceMisuse('rg -rn "loadHNSWIndexFromDisk" src/')).toBe('rg -n "loadHNSWIndexFromDisk" src/');
  });

  test("rewrites rg -rl to rg -l", () => {
    expect(rewriteRgReplaceMisuse('rg -rl "rebuildHNSWIndex" src/')).toBe('rg -l "rebuildHNSWIndex" src/');
  });

  test("rewrites rg -rw to rg -w", () => {
    expect(rewriteRgReplaceMisuse('rg -rw "foo" src/')).toBe('rg -w "foo" src/');
  });

  test("preserves combined flags before -r", () => {
    expect(rewriteRgReplaceMisuse('rg -i -rn "foo" src/')).toBe('rg -i -n "foo" src/');
  });

  test("preserves cd prefix", () => {
    expect(rewriteRgReplaceMisuse('cd /repo && rg -rn "flattenStructure" src/ | head -2')).toBe(
      'cd /repo && rg -n "flattenStructure" src/ | head -2',
    );
  });

  test("preserves redirects after -r", () => {
    expect(rewriteRgReplaceMisuse('rg -rn "foo" src/ 2>/dev/null')).toBe('rg -n "foo" src/ 2>/dev/null');
  });

  test("returns null for correct usage", () => {
    expect(rewriteRgReplaceMisuse('rg -n "foo" src/')).toBeNull();
  });

  test("returns null for quoted --replace value", () => {
    expect(rewriteRgReplaceMisuse('rg -r "replacement" -l "foo" src/')).toBeNull();
  });

  test("returns null for --replace long form", () => {
    expect(rewriteRgReplaceMisuse('rg --replace n -l "foo" src/')).toBeNull();
  });

  test("returns null for non-grep commands", () => {
    expect(rewriteRgReplaceMisuse("bun run dev")).toBeNull();
    expect(rewriteRgReplaceMisuse("")).toBeNull();
  });
});

describe("createToolBeforeGuardHandler — tool.before rewrite", () => {
  test("rewrites args.command in tool.before (output shape)", async () => {
    const handler = createToolBeforeGuardHandler();
    const out: { args?: Record<string, unknown> } = { args: { command: 'rg -rn "flattenStructure" src/' } };
    await handler["tool.before"]!(
      { tool: "bash", sessionID: "b1", callID: "c1" },
      out,
    );
    expect(out.args?.command).toBe('rg -n "flattenStructure" src/');
  });

  test("rewrites args.command when passed via input", async () => {
    const handler = createToolBeforeGuardHandler();
    const out: { args?: Record<string, unknown> } = {};
    await handler["tool.before"]!(
      { tool: "bash", args: { command: 'rg -rn "flattenStructure" src/' }, sessionID: "b1b", callID: "c1b" },
      out,
    );
    expect(out.args).toBeUndefined();
  });

  test("does not touch non-bash tools", async () => {
    const handler = createToolBeforeGuardHandler();
    const out: { args?: Record<string, unknown> } = { args: { filePath: "a.ts" } };
    await handler["tool.before"]!({ tool: "read", sessionID: "b2", callID: "c2" }, out);
    expect(out.args?.command).toBeUndefined();
  });

  test("does not mutate correct commands", async () => {
    const handler = createToolBeforeGuardHandler();
    const out: { args?: Record<string, unknown> } = { args: { command: 'rg -n "foo" src/' } };
    await handler["tool.before"]!({ tool: "bash", sessionID: "b3", callID: "c3" }, out);
    expect(out.args?.command).toBe('rg -n "foo" src/');
  });

  test("appends auto-correct note in tool.after after a rewrite", async () => {
    const handler = createToolBeforeGuardHandler();
    const beforeOut: { args?: Record<string, unknown> } = { args: { command: 'rg -rn "x" src/' } };
    await handler["tool.before"]!(
      { tool: "bash", sessionID: "b4", callID: "c4" },
      beforeOut,
    );
    const afterOut = { output: "clean results here" };
    await handler["tool.after"]!(
      { tool: "bash", args: { command: beforeOut.args?.command as string }, sessionID: "b4", callID: "c4" },
      afterOut,
    );
    expect(afterOut.output).toContain("[rg-footgun] auto-corrected");
    expect(afterOut.output).toContain("rg -rn");
    expect(afterOut.output).toContain("rg -n");
    expect(afterOut.output).toContain("clean results here");
  });
});

describe("createToolBeforeGuardHandler — tool.after delivery", () => {
  test("appends rg-footgun hint to bash output", async () => {
    const handler = createToolBeforeGuardHandler();
    const out = { output: "export function n(items) { ... }" };
    await handler["tool.after"]!(
      { tool: "bash", args: { command: 'rg -rn "flattenStructure" src/' }, sessionID: "s1" },
      out,
    );
    expect(out.output).toContain("[rg-footgun]");
    expect(out.output).toContain("`rg -rn`");
    expect(out.output).toContain("Use `rg -n` instead");
  });

  test("creates output when undefined", async () => {
    const handler = createToolBeforeGuardHandler();
    const out: { output?: string } = {};
    await handler["tool.after"]!({ tool: "bash", args: { command: 'rg -rn "x" src/' }, sessionID: "s2" }, out);
    expect(out.output).toContain("[rg-footgun]");
  });

  test("does not touch non-bash tools", async () => {
    const handler = createToolBeforeGuardHandler();
    const out = { output: "file content" };
    await handler["tool.after"]!({ tool: "read", args: { filePath: "a.ts" }, sessionID: "s3" }, out);
    expect(out.output).toBe("file content");
  });

  test("does not touch bash without the footgun", async () => {
    const handler = createToolBeforeGuardHandler();
    const out = { output: "clean result" };
    await handler["tool.after"]!({ tool: "bash", args: { command: 'rg -n "foo" src/' }, sessionID: "s4" }, out);
    expect(out.output).toBe("clean result");
  });

  test("respects per-session hint cap", async () => {
    const handler = createToolBeforeGuardHandler();
    for (let i = 1; i <= 3; i++) {
      const out = { output: `call-${i}` };
      await handler["tool.after"]!({ tool: "bash", args: { command: 'rg -rn "x" src/' }, sessionID: "s5" }, out);
      expect(out.output).toContain("[rg-footgun]");
    }
    const out4 = { output: "fourth" };
    await handler["tool.after"]!({ tool: "bash", args: { command: 'rg -rn "x" src/' }, sessionID: "s5" }, out4);
    expect(out4.output).toBe("fourth");
  });
});

describe("rgFootgunHint", () => {
  test("mentions the misuse letters and correct command", () => {
    const h = rgFootgunHint("n");
    expect(h).toContain("rg -rn");
    expect(h).toContain("--replace");
    expect(h).toContain("rg -n");
  });
});
