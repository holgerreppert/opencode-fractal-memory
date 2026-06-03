import type { MemoryScope, MemoryNode, MemoryNodeLevel, FractalStats } from "./types";

export async function getNodeDepth(
  getNode: (id: string) => Promise<MemoryNode>,
  node: MemoryNode,
  depthCache: Map<string, number>,
  visited = new Set<string>()
): Promise<number> {
  if (!node.parentIds || node.parentIds.length === 0) return 0;
  if (visited.has(node.id)) return 0;

  const cached = depthCache.get(node.id);
  if (cached !== undefined) return cached;

  visited.add(node.id);

  let maxParentDepth = 0;
  for (const parentId of node.parentIds) {
    try {
      const parent = await getNode(parentId);
      const parentDepth = await getNodeDepth(getNode, parent, depthCache, visited);
      maxParentDepth = Math.max(maxParentDepth, parentDepth);
    } catch {
      // Parent not found, skip
    }
  }

  const depth = 1 + maxParentDepth;
  depthCache.set(node.id, depth);
  return depth;
}

export async function retrieveFractal(
  getNode: (id: string) => Promise<MemoryNode>,
  id: string,
  maxDepth: number = 10
): Promise<{
  node: MemoryNode;
  path: MemoryNode[];
  depth: number;
  relevanceScore: number;
}> {
  const node = await getNode(id);
  const path: MemoryNode[] = [];
  const visited = new Set<string>();

  let currentNode: MemoryNode | undefined = node;
  let depth = 0;

  while (currentNode && depth < maxDepth) {
    path.push(currentNode);
    if (!currentNode.parentIds || currentNode.parentIds.length === 0) break;
    if (visited.has(currentNode.id)) break;
    visited.add(currentNode.id);

    const parentId = currentNode.parentIds[0];
    if (!parentId) break;

    try {
      currentNode = await getNode(parentId);
      depth++;
    } catch {
      break;
    }
  }

  return {
    node,
    path,
    depth,
    relevanceScore: node.importance,
  };
}

export async function getFractalStats(
  listNodes: (scope: MemoryScope | "all") => Promise<MemoryNode[]>,
  getNode: (id: string) => Promise<MemoryNode>,
  scope: MemoryScope | "all"
): Promise<FractalStats> {
  const depthCache = new Map<string, number>();
  const allNodes = await listNodes(scope);

  const nodesPerLevel: Record<MemoryNodeLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let hasEmbeddings = 0;
  const scopes = { global: 0, project: 0 };
  const parentCounts: number[] = [];
  let maxDepth = 0;

  for (const node of allNodes) {
    nodesPerLevel[node.level]++;
    scopes[node.scope]++;
    if (node.embedding) hasEmbeddings++;

    if (node.parentIds && node.parentIds.length > 0) {
      parentCounts.push(node.parentIds.length);
      const parentDepth = await getNodeDepth(getNode, node, depthCache);
      maxDepth = Math.max(maxDepth, parentDepth);
    }
  }

  const totalNodes = allNodes.length;
  const compressionRatios: Record<number, number> = {};
  for (let level = 0; level < 5; level++) {
    const current = nodesPerLevel[level as MemoryNodeLevel];
    const next = nodesPerLevel[(level + 1) as MemoryNodeLevel];
    compressionRatios[level] = next > 0 && current > 0 ? current / next : 0;
  }

  const fractalDimension = totalNodes > 1 && maxDepth > 0
    ? Math.log(totalNodes) / Math.log(1 + maxDepth)
    : 0;

  const avgChildren = parentCounts.length > 0
    ? parentCounts.reduce((a, b) => a + b, 0) / parentCounts.length
    : 0;

  return {
    totalNodes,
    nodesPerLevel,
    compressionRatios,
    fractalDimension: Math.round(fractalDimension * 100) / 100,
    avgChildrenPerNode: Math.round(avgChildren * 100) / 100,
    treeDepth: maxDepth,
    hasEmbeddings,
    scopes,
  };
}
