import { describe, expect, test } from "bun:test";
import { createSignature, createToolDedupCache, type ToolDedupConfig } from "./tool-dedup";

const defaultConfig: ToolDedupConfig = {
  enabled: true,
  maxCacheEntries: 100,
  protectedTools: ["read", "write"],
  turnProtectionTurns: 2,
};

const LONG_OUTPUT = "x".repeat(20);

describe("createSignature", () => {
  test("creates deterministic signature from tool and args", () => {
    const sig1 = createSignature("read", { filePath: "/foo.ts" });
    const sig2 = createSignature("read", { filePath: "/foo.ts" });
    expect(sig1).toBe(sig2);
  });

  test("sort keys alphabetically", () => {
    const sig = createSignature("grep", { pattern: "foo", path: "." });
    expect(sig).toContain('"path"');
    expect(sig).toContain('"pattern"');
  });

  test("ignores undefined and null values", () => {
    const sig1 = createSignature("test", { a: "1", b: undefined });
    const sig2 = createSignature("test", { a: "1" });
    expect(sig1).toBe(sig2);
  });

  test("stringifies nested object values", () => {
    const sig = createSignature("edit", { args: { old: "a", new: "b" } });
    expect(sig).toContain('old');
    expect(sig).toContain('new');
  });
});

describe("createToolDedupCache", () => {
  test("check returns null when disabled", () => {
    const cache = createToolDedupCache(100);
    const result = cache.check("grep", { pattern: "foo" }, { ...defaultConfig, enabled: false });
    expect(result).toBeNull();
  });

  test("check returns null for protected tools", () => {
    const cache = createToolDedupCache(100);
    const result = cache.check("read", { filePath: "/foo.ts" }, defaultConfig);
    expect(result).toBeNull();
  });

  test("check returns null for uncached tool call", () => {
    const cache = createToolDedupCache(100);
    const result = cache.check("grep", { pattern: "foo" }, defaultConfig);
    expect(result).toBeNull();
  });

  test("record + check returns cached output after turn protection passes", () => {
    const cache = createToolDedupCache(100);
    cache.record("grep", { pattern: "foo" }, LONG_OUTPUT);
    cache.nextTurn();
    cache.nextTurn();
    cache.nextTurn();
    const result = cache.check("grep", { pattern: "foo" }, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.cached).toBe(true);
    expect(result!.output).toBe(LONG_OUTPUT);
  });

  test("check returns null within turn protection window", () => {
    const cache = createToolDedupCache(100);
    cache.record("grep", { pattern: "foo" }, LONG_OUTPUT);
    const result = cache.check("grep", { pattern: "foo" }, defaultConfig);
    expect(result).toBeNull();
  });

  test("different arguments produce different cache entries", () => {
    const cache = createToolDedupCache(100);
    cache.record("grep", { pattern: "foo" }, "result-foo-" + LONG_OUTPUT);
    cache.record("grep", { pattern: "bar" }, "result-bar-" + LONG_OUTPUT);
    cache.nextTurn();
    cache.nextTurn();
    cache.nextTurn();
    const result = cache.check("grep", { pattern: "foo" }, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.output).toBe("result-foo-" + LONG_OUTPUT);
  });

  test("evicts oldest entries when over max", () => {
    const cache = createToolDedupCache(2);
    cache.record("cmd", { x: "a" }, LONG_OUTPUT + "-a");
    cache.record("cmd", { x: "b" }, LONG_OUTPUT + "-b");
    cache.record("cmd", { x: "c" }, LONG_OUTPUT + "-c");
    cache.nextTurn();
    cache.nextTurn();
    cache.nextTurn();
    expect(cache.check("cmd", { x: "a" }, defaultConfig)).toBeNull();
    expect(cache.check("cmd", { x: "c" }, defaultConfig)).not.toBeNull();
  });

  test("skip recording short output", () => {
    const cache = createToolDedupCache(100);
    cache.record("cmd", { x: "a" }, "short");
    cache.nextTurn();
    cache.nextTurn();
    cache.nextTurn();
    expect(cache.check("cmd", { x: "a" }, defaultConfig)).toBeNull();
  });

  test("clear empties cache", () => {
    const cache = createToolDedupCache(100);
    cache.record("cmd", { x: "a" }, LONG_OUTPUT);
    cache.nextTurn();
    cache.nextTurn();
    cache.nextTurn();
    cache.clear();
    expect(cache.check("cmd", { x: "a" }, defaultConfig)).toBeNull();
  });

  test("size reflects entry count", () => {
    const cache = createToolDedupCache(100);
    expect(cache.size).toBe(0);
    cache.record("cmd", { x: "a" }, LONG_OUTPUT);
    expect(cache.size).toBe(1);
  });
});
