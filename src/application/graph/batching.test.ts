import { describe, expect, test } from "bun:test";
import { CodeGraph } from "./graph";
import { chunkFiles, mergeGraphJSON } from "./batching";

describe("chunkFiles", () => {
  test("splits into even chunks of the given size", () => {
    expect(chunkFiles([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("returns empty for empty input", () => {
    expect(chunkFiles([], 2)).toEqual([]);
  });

  test("returns single chunk when input fits", () => {
    expect(chunkFiles(["a", "b"], 5)).toEqual([["a", "b"]]);
  });
});

describe("mergeGraphJSON", () => {
  test("unions nodes and edges into the target graph", () => {
    const target = new CodeGraph();
    const fileA = target.addFile("/repo/src/a.ts");
    const symA = target.addSymbol("/repo/src/a.ts", "foo", "function", 1);
    target.addCall(symA, fileA);

    const partial = new CodeGraph();
    const fileB = partial.addFile("/repo/src/b.ts");
    const symB = partial.addSymbol("/repo/src/b.ts", "bar", "function", 3);
    partial.addCall(symB, fileB);
    partial.markExtracted("/repo/src/b.ts", "content-b");

    mergeGraphJSON(target, partial.toJSON());

    // target keeps its own nodes
    expect(target.graph.hasNode(fileA)).toBe(true);
    expect(target.graph.hasNode(symA)).toBe(true);
    // partial nodes merged in
    expect(target.graph.hasNode(fileB)).toBe(true);
    expect(target.graph.hasNode(symB)).toBe(true);
    // edges from partial present, with their relation preserved
    expect(target.graph.hasEdge(`${symB}→calls→${fileB}`)).toBe(true);
    // fileHashes merged (markExtracted stores a content hash, not raw content)
    expect(target.fileHashes["/repo/src/b.ts"]).toBe(partial.fileHashes["/repo/src/b.ts"]);
  });

  test("dedups nodes that already exist in the target", () => {
    const target = new CodeGraph();
    target.addFile("/repo/src/a.ts");

    const partial = new CodeGraph();
    const id = partial.addFile("/repo/src/a.ts");
    partial.markExtracted("/repo/src/a.ts", "content-a");

    mergeGraphJSON(target, partial.toJSON());

    let count = 0;
    target.graph.forEachNode(() => count++);
    expect(count).toBe(1);
    expect(target.fileHashes["/repo/src/a.ts"]).toBe(partial.fileHashes["/repo/src/a.ts"]);
  });

  test("does not clobber existing target hashes when partial lacks them", () => {
    const target = new CodeGraph();
    target.fileHashes["/repo/src/a.ts"] = "old";
    mergeGraphJSON(target, { nodes: [], edges: [] });
    expect(target.fileHashes["/repo/src/a.ts"]).toBe("old");
  });
});
