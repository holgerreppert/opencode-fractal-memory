import { bidirectional } from "graphology-shortest-path";
import type { CodeGraph, NodeData } from "./graph";

export interface PathResult {
  path: { id: string; label: string; file?: string; line?: number }[];
  length: number;
}

export function shortestPath(
  graph: CodeGraph,
  fromId: string,
  toId: string,
): PathResult | null {
  if (!graph.graph.hasNode(fromId) || !graph.graph.hasNode(toId)) return null;
  try {
    const path = bidirectional(graph.graph, fromId, toId);
    if (!path) return null;
    return {
      path: path.map(id => {
        const attrs = graph.graph.getNodeAttributes(id) as unknown as NodeData;
        return { id, label: attrs.label, file: attrs.file, line: attrs.line };
      }),
      length: path.length - 1,
    };
  } catch {
    return null;
  }
}

export interface NeighborResult {
  id: string;
  label: string;
  relation: string;
  file?: string;
  line?: number;
}

export function getNeighbors(graph: CodeGraph, nodeId: string): NeighborResult[] {
  if (!graph.graph.hasNode(nodeId)) return [];
  const results: NeighborResult[] = [];
  graph.graph.forEachEdge((_key, attrs, source, target) => {
    const neighborId = source === nodeId ? target : source;
    const nAttrs = graph.graph.getNodeAttributes(neighborId) as unknown as NodeData;
    const edgeAttrs = attrs as unknown as { relation: string };
    results.push({
      id: neighborId,
      label: nAttrs.label,
      relation: source === nodeId ? edgeAttrs.relation : `inverse_${edgeAttrs.relation}`,
      file: nAttrs.file,
      line: nAttrs.line,
    });
  });
  return results;
}

export interface ExplainResult {
  node: NodeData;
  neighbors: NeighborResult[];
  degree: number;
  community?: string;
}

export function explain(graph: CodeGraph, nodeId: string): ExplainResult | null {
  if (!graph.graph.hasNode(nodeId)) return null;
  const attrs = graph.graph.getNodeAttributes(nodeId) as unknown as NodeData;
  return {
    node: attrs,
    neighbors: getNeighbors(graph, nodeId),
    degree: graph.graph.degree(nodeId),
    community: attrs.community,
  };
}

export interface SearchResult {
  id: string;
  label: string;
  type: string;
  kind?: string;
  file?: string;
  line?: number;
}

export function searchNodes(graph: CodeGraph, query: string): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];
  graph.graph.forEachNode((id, attrs) => {
    const n = attrs as unknown as NodeData;
    if (n.label.toLowerCase().includes(q) || n.file?.toLowerCase().includes(q)) {
      results.push({
        id,
        label: n.label,
        type: n.type,
        kind: n.kind,
        file: n.file,
        line: n.line,
      });
    }
  });
  return results;
}
