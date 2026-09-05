import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { squeezExtract, squeezExtractSync } from "./squeez";

const baseCfg = { enabled: true as const, baseUrl: "http://localhost:8000/", model: "KRLabsOrg/squeez-2b", minOutputChars: 10, timeoutMs: 200, deferToIdle: false as const };

describe("squeezExtract edge cases", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; mock.restore?.(); });

  it("returns null when disabled", async () => {
    const r = await squeezExtract("x".repeat(3000), "query", { enabled: false, baseUrl: "http://localhost:8000", model: "x", minOutputChars: 10, timeoutMs: 200 });
    expect(r).toBeNull();
  });
  it("returns null when deferToIdle true (sync no-op)", async () => {
    const r = await squeezExtract("x".repeat(3000), "query", { enabled: true, baseUrl: "http://localhost:8000", model: "x", minOutputChars: 10, timeoutMs: 100, deferToIdle: true });
    expect(r).toBeNull();
  });
  it("returns null when deferToIdle undefined (defaults to true)", async () => {
    const r = await squeezExtract("x".repeat(3000), "query", { enabled: true, baseUrl: "http://localhost:8000", model: "x", minOutputChars: 10, timeoutMs: 100 } as any);
    expect(r).toBeNull();
  });
  it("returns null when config undefined", async () => {
    const r = await squeezExtract("x".repeat(3000), "query", undefined);
    expect(r).toBeNull();
  });
  it("returns null on short output (below minOutputChars)", async () => {
    const r = await squeezExtract("short", "query", { ...baseCfg, minOutputChars: 2000 });
    expect(r).toBeNull();
  });
  it("returns null on empty query / whitespace", async () => {
    expect(await squeezExtract("x".repeat(20), "", baseCfg)).toBeNull();
    expect(await squeezExtract("x".repeat(20), "   ", baseCfg)).toBeNull();
  });
  it("handles baseUrl trailing slash (no double //)", async () => {
    let urlSeen = "";
    globalThis.fetch = (async (url: string) => { urlSeen = url; return { ok: true, json: async () => ({ relevant_lines: ["a"] }) } as any; }) as any;
    const r = await squeezExtract("x".repeat(20), "q", { ...baseCfg, baseUrl: "http://localhost:8000/" });
    expect(urlSeen).toBe("http://localhost:8000/extract");
    expect(r).toBe("a");
  });
  it("handles baseUrl without trailing slash", async () => {
    let urlSeen = "";
    globalThis.fetch = (async (url: string) => { urlSeen = url; return { ok: true, json: async () => ({ relevant_lines: ["b"] }) } as any; }) as any;
    const r = await squeezExtract("x".repeat(20), "q", { ...baseCfg, baseUrl: "http://localhost:8000" });
    expect(urlSeen).toBe("http://localhost:8000/extract");
    expect(r).toBe("b");
  });
  it("returns null on http error (500)", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) } as any)) as any;
    const r = await squeezExtract("x".repeat(20), "q", baseCfg);
    expect(r).toBeNull();
  });
  it("returns null on fetch throw / abort", async () => {
    globalThis.fetch = (async () => { throw new Error("network down"); }) as any;
    const r = await squeezExtract("x".repeat(20), "q", baseCfg);
    expect(r).toBeNull();
  });
  it("parses array relevant_lines -> joined", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ relevant_lines: ["line1", "line2"] }) } as any)) as any;
    const r = await squeezExtract("x".repeat(20), "q", baseCfg);
    expect(r).toBe("line1\nline2");
  });
  it("parses array empty -> empty string (negative, 80% Squeez)", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ relevant_lines: [] }) } as any)) as any;
    const r = await squeezExtract("x".repeat(20), "q", baseCfg);
    expect(r).toBe("");
  });
  it("parses string relevant_lines", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ relevant_lines: "verbatim block" }) } as any)) as any;
    const r = await squeezExtract("x".repeat(20), "q", baseCfg);
    expect(r).toBe("verbatim block");
  });
  it("falls back to output/result keys", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ output: "from output" }) } as any)) as any;
    expect(await squeezExtract("x".repeat(20), "q", baseCfg)).toBe("from output");
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ result: "from result" }) } as any)) as any;
    expect(await squeezExtract("x".repeat(20), "q", baseCfg)).toBe("from result");
  });
  it("falls back to <relevant_lines> tag in text", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ text: "blah <relevant_lines>  kept  </relevant_lines> tail" }) } as any)) as any;
    const r = await squeezExtract("x".repeat(20), "q", baseCfg);
    expect(r).toBe("kept");
  });
  it("returns null when no parseable field", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ foo: "bar" }) } as any)) as any;
    const r = await squeezExtract("x".repeat(20), "q", baseCfg);
    expect(r).toBeNull();
  });
  it("minOutputChars boundary: exactly at threshold compresses", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ relevant_lines: ["ok"] }) } as any)) as any;
    const cfg = { ...baseCfg, minOutputChars: 20 };
    expect(await squeezExtract("x".repeat(20), "q", cfg)).toBe("ok");
    expect(await squeezExtract("x".repeat(19), "q", cfg)).toBeNull();
  });
});

describe("squeezExtractSync edge", () => {
  it("always null (pipeline sync no-op)", () => {
    expect(squeezExtractSync("x".repeat(20), "q", baseCfg)).toBeNull();
    expect(squeezExtractSync("x".repeat(20), "q", undefined)).toBeNull();
    expect(squeezExtractSync("", "", undefined)).toBeNull();
  });
});
