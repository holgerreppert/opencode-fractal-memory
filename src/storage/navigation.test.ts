import { describe, expect, test } from "bun:test";
import { getNodeDepth, retrieveFractal, getFractalStats } from "./navigation";
import type { MemoryNode, MemoryScope, FractalStats } from "./types";

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: overrides.id ?? "node-1",
    scope: overrides.scope ?? "project",
    label: overrides.label ?? "test-node",
    content: overrides.content ?? "Some content",
    summary: overrides.summary ?? null,
    level: overrides.level ?? 0,
    parentIds: overrides.parentIds ?? null,
    embedding: overrides.embedding ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    importance: overrides.importance ?? 0.5,
    accessCount: overrides.accessCount ?? 0,
    lastAccessed: overrides.lastAccessed ?? null,
    type: overrides.type ?? null,
    metadata: overrides.metadata ?? null,
    sticky: overrides.sticky ?? false,
    confidence: overrides.confidence ?? 0,
    lastVerified: overrides.lastVerified ?? null,
    usefulnessScore: overrides.usefulnessScore ?? 0,
    timesUsed: overrides.timesUsed ?? 0,
    timesHelpful: overrides.timesHelpful ?? 0,
  };
}

describe("getNodeDepth", () => {
  test("returns 0 for root node (no parents)", async () => {
    const node = makeNode({ id: "root", parentIds: null });
    const depth = await getNodeDepth(async () => node, node, new Map());
    expect(depth).toBe(0);
  });

  test("returns 0 for node with empty parents array", async () => {
    const node = makeNode({ id: "root", parentIds: [] });
    const depth = await getNodeDepth(async () => node, node, new Map());
    expect(depth).toBe(0);
  });

  test("returns depth based on parent chain", async () => {
    const grandparent = makeNode({ id: "gp", parentIds: null });
    const parent = makeNode({ id: "p", parentIds: ["gp"] });
    const child = makeNode({ id: "c", parentIds: ["p"] });

    const getNode = async (id: string) => {
      if (id === "gp") return grandparent;
      if (id === "p") return parent;
      if (id === "c") return child;
      throw new Error(`Not found: ${id}`);
    };

    const depth = await getNodeDepth(getNode, child, new Map());
    expect(depth).toBe(2);
  });

  test("stores computed depth in cache", async () => {
    const parent = makeNode({ id: "p", parentIds: null });
    const child = makeNode({ id: "c", parentIds: ["p"] });
    const cache = new Map<string, number>();

    const getNode = async (id: string) => {
      if (id === "p") return parent;
      if (id === "c") return child;
      throw new Error(`Not found: ${id}`);
    };

    const depth = await getNodeDepth(getNode, child, cache);
    expect(depth).toBe(1);
    expect(cache.get("c")).toBe(1);
  });

  test("handles missing parent gracefully", async () => {
    const orphan = makeNode({ id: "orphan", parentIds: ["missing-parent"] });

    const getNode = async (id: string) => {
      if (id === "missing-parent") throw new Error("Not found");
      return orphan;
    };

    const depth = await getNodeDepth(getNode, orphan, new Map());
    expect(depth).toBe(1);
  });

  test("detects cycles and returns 0", async () => {
    const node = makeNode({ id: "cyclic", parentIds: ["cyclic"] });

    const getNode = async () => node;

    const visited = new Set(["cyclic"]);
    const depth = await getNodeDepth(getNode, node, new Map(), visited);
    expect(depth).toBe(0);
  });
});

describe("retrieveFractal", () => {
  test("returns node and path for root", async () => {
    const node = makeNode({ id: "root", parentIds: null });

    const result = await retrieveFractal(async () => node, "root");

    expect(result.node.id).toBe("root");
    expect(result.path).toHaveLength(1);
    expect(result.depth).toBe(0);
    expect(result.relevanceScore).toBe(node.importance);
  });

  test("follows parent chain", async () => {
    const parent = makeNode({ id: "parent", parentIds: null });
    const child = makeNode({ id: "child", parentIds: ["parent"] });
    const grandchild = makeNode({ id: "grandchild", parentIds: ["child"] });

    const getNode = async (id: string) => {
      if (id === "parent") return parent;
      if (id === "child") return child;
      if (id === "grandchild") return grandchild;
      throw new Error(`Not found: ${id}`);
    };

    const result = await retrieveFractal(getNode, "grandchild");

    expect(result.path).toHaveLength(3);
    expect(result.path[0]!.id).toBe("grandchild");
    expect(result.path[1]!.id).toBe("child");
    expect(result.path[2]!.id).toBe("parent");
    expect(result.depth).toBe(2);
  });

  test("stops when parent is not found", async () => {
    const child = makeNode({ id: "child", parentIds: ["missing"] });

    const getNode = async (id: string) => {
      if (id === "missing") throw new Error("Not found");
      return child;
    };

    const result = await retrieveFractal(getNode, "child");
    expect(result.path).toHaveLength(1);
    expect(result.depth).toBe(0);
  });

  test("respects max depth", async () => {
    const parent = makeNode({ id: "parent", parentIds: null });
    const child = makeNode({ id: "child", parentIds: ["parent"] });
    const grandchild = makeNode({ id: "grandchild", parentIds: ["child"] });

    const getNode = async (id: string) => {
      if (id === "parent") return parent;
      if (id === "child") return child;
      if (id === "grandchild") return grandchild;
      throw new Error(`Not found: ${id}`);
    };

    const result = await retrieveFractal(getNode, "grandchild", 1);

    expect(result.path).toHaveLength(1);
    expect(result.depth).toBe(1);
  });

  test("stops at cycle", async () => {
    const node = makeNode({ id: "cyclic", parentIds: ["cyclic"] });

    const result = await retrieveFractal(async () => node, "cyclic");

    expect(result.path).toHaveLength(2);
    expect(result.depth).toBe(1);
  });
});

describe("getFractalStats", () => {
  test("returns stats for empty scope", async () => {
    const listNodes = async () => [];
    const getNode = async (id: string): Promise<MemoryNode> => { throw new Error("Not found"); };

    const stats = await getFractalStats(listNodes, getNode, "project");

    expect(stats.totalNodes).toBe(0);
    expect(stats.nodesPerLevel).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(stats.fractalDimension).toBe(0);
    expect(stats.treeDepth).toBe(0);
  });

  test("counts nodes per level and scope", async () => {
    const nodes = [
      makeNode({ id: "a", level: 0, scope: "project", embedding: [0.1, 0.2] }),
      makeNode({ id: "b", level: 0, scope: "project" }),
      makeNode({ id: "c", level: 1, scope: "global", embedding: [0.3, 0.4] }),
    ];

    const listNodes = async () => nodes;
    const getNode = async (id: string) => { throw new Error("Not found"); };

    const stats = await getFractalStats(listNodes, getNode, "all");

    expect(stats.totalNodes).toBe(3);
    expect(stats.nodesPerLevel[0]).toBe(2);
    expect(stats.nodesPerLevel[1]).toBe(1);
    expect(stats.scopes.project).toBe(2);
    expect(stats.scopes.global).toBe(1);
    expect(stats.hasEmbeddings).toBe(2);
  });

  test("computes compression ratios", async () => {
    const nodes = [
      makeNode({ id: "a", level: 0, scope: "project" }),
      makeNode({ id: "b", level: 0, scope: "project" }),
      makeNode({ id: "c", level: 1, scope: "project" }),
    ];

    const listNodes = async () => nodes;
    const getNode = async (id: string) => { throw new Error("Not found"); };

    const stats = await getFractalStats(listNodes, getNode, "all");

    expect(stats.compressionRatios[0]).toBe(2);
    expect(stats.compressionRatios[1]).toBe(0);
  });

  test("computes tree depth and children", async () => {
    const nodes = [
      makeNode({ id: "a", level: 0, scope: "project", parentIds: ["b"] }),
      makeNode({ id: "b", level: 0, scope: "project", parentIds: null }),
      makeNode({ id: "c", level: 1, scope: "project", parentIds: ["a"] }),
    ];

    const getNode = async (id: string) => {
      const found = nodes.find(n => n.id === id);
      if (!found) throw new Error(`Not found: ${id}`);
      return found;
    };

    const listNodes = async () => nodes;

    const stats = await getFractalStats(listNodes, getNode, "all");

    expect(stats.treeDepth).toBeGreaterThanOrEqual(1);
    expect(stats.avgChildrenPerNode).toBeGreaterThan(0);
    expect(stats.fractalDimension).toBeGreaterThan(0);
  });
});
