import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createExpandTool } from "./expand";

const SCRATCH = path.join(os.homedir(), ".config", "opencode", "scratch");

describe("expand tool", () => {
  const tool = createExpandTool();
  const payload = Array.from({ length: 100 }, (_, i) => (i === 50 ? "ERROR: failure at test 50" : `line ${i} padding`)).join("\n");
  let ref: string;

  beforeAll(() => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    ref = path.join(SCRATCH, `expand-test-${Date.now()}.out`);
    fs.writeFileSync(ref, payload, "utf-8");
  });
  afterAll(() => {
    try { fs.unlinkSync(ref); } catch {}
  });

  test("full returns content with footer", async () => {
    const res = await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ref }, {});
    expect(res).toContain("line 0");
    expect(res).toContain(ref);
  });

  test("slice head returns first 50 lines", async () => {
    const res = await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ref, slice: "head" }, {});
    expect(res).toContain("line 0");
    expect(res).not.toContain("line 99");
  });

  test("slice tail returns last 50 lines", async () => {
    const res = await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ref, slice: "tail" }, {});
    expect(res).toContain("line 99");
    expect(res).toContain("ERROR: failure");
  });

  test("filter error returns only error span ±3", async () => {
    const res = await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ref, filter: "error" }, {});
    expect(res).toContain("ERROR: failure");
    expect(res).toContain("error-filter");
    // should not contain distant head
    expect((res.match(/line 99/g) ?? []).length).toBe(0);
  });

  test("bare hash resolves", async () => {
    const hash = path.basename(ref).replace(".out", "");
    const res = await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ref: hash }, {});
    expect(res).toContain("line 0");
  });

  test("missing ref fails open with Error:", async () => {
    const res = await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ref: "/tmp/not-exist-xyz.out" }, {});
    expect(res).toContain("Error: ref not found");
  });

  test("maxTokens truncates", async () => {
    const bigRef = path.join(SCRATCH, `expand-big-${Date.now()}.out`);
    const big = "x".repeat(20000);
    fs.writeFileSync(bigRef, big, "utf-8");
    const res = await (tool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ref: bigRef, maxTokens: 100 }, {});
    expect(res).toContain("truncated to");
    try { fs.unlinkSync(bigRef); } catch {}
  });
});
