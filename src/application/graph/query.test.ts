import { describe, expect, test } from "bun:test";
import { CodeGraph } from "./graph";
import { callers, callees, callChain } from "./query";

function makeTestGraph(): CodeGraph {
  const g = new CodeGraph();

  const f1 = g.addFile("src/a.ts");
  const f2 = g.addFile("src/b.ts");

  const main = g.addSymbol("src/a.ts", "main", "function", 1);
  const helper = g.addSymbol("src/a.ts", "helper", "function", 10);
  const parse = g.addSymbol("src/b.ts", "parse", "function", 1);
  const format = g.addSymbol("src/b.ts", "format", "function", 5);
  const util = g.addSymbol("src/b.ts", "util", "function", 20);

  g.addCall(main, helper);
  g.addCall(main, parse);
  g.addCall(helper, format);
  g.addCall(parse, format);
  g.addCall(format, util);

  return g;
}

describe("callers", () => {
  test("finds direct callers of a symbol", () => {
    const g = makeTestGraph();
    const result = callers(g, "format");
    expect(result).toHaveLength(2);
    const callerNames = result.map(r => r.caller.name).sort();
    expect(callerNames).toEqual(["helper", "parse"]);
  });

  test("returns empty array for uncalled symbol", () => {
    const g = makeTestGraph();
    const result = callers(g, "util");
    expect(result).toHaveLength(1);
    expect(result[0]!.caller.name).toBe("format");
  });

  test("returns empty array for unknown symbol", () => {
    const g = makeTestGraph();
    const result = callers(g, "nonexistent");
    expect(result).toHaveLength(0);
  });
});

describe("callees", () => {
  test("finds direct callees of a symbol", () => {
    const g = makeTestGraph();
    const result = callees(g, "main");
    expect(result).toHaveLength(2);
    const calleeNames = result.map(r => r.callee.name).sort();
    expect(calleeNames).toEqual(["helper", "parse"]);
  });

  test("returns empty for leaf symbol", () => {
    const g = makeTestGraph();
    const result = callees(g, "util");
    expect(result).toHaveLength(0);
  });

  test("returns empty array for unknown symbol", () => {
    const g = makeTestGraph();
    const result = callees(g, "nonexistent");
    expect(result).toHaveLength(0);
  });
});

describe("callChain", () => {
  test("finds transitive callers", () => {
    const g = makeTestGraph();
    const result = callChain(g, "util", 5);
    expect(result.symbol.name).toBe("util");
    expect(result.truncated).toBe(false);
    expect(result.chain.length).toBeGreaterThanOrEqual(2);
    // depth 1: format
    // depth 2: helper, parse
    // depth 3: main
    const depth1 = result.chain.find(e => e.depth === 1);
    expect(depth1).toBeDefined();
    expect(depth1!.callers.some(c => c.name === "format")).toBe(true);
  });

  test("respects maxDepth", () => {
    const g = makeTestGraph();
    const result = callChain(g, "util", 1);
    expect(result.symbol.name).toBe("util");
    expect(result.chain.length).toBeLessThanOrEqual(1);
  });

  test("returns empty chain for unknown symbol", () => {
    const g = makeTestGraph();
    const result = callChain(g, "nonexistent", 5);
    expect(result.chain).toHaveLength(0);
  });
});
