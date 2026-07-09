import { bidirectional } from "graphology-shortest-path";
import type { CodeGraph, NodeData } from "./graph";

export interface PathResult {
  path: { id: string; label: string; file?: string | undefined; line?: number | undefined }[];
  length: number;
}

export interface SymbolRef {
  id: string;
  name: string;
  kind?: string | undefined;
  file: string;
  line?: number | undefined;
}

export interface CallerResult {
  caller: SymbolRef;
  callee: SymbolRef;
}

export interface CalleeResult {
  caller: SymbolRef;
  callee: SymbolRef;
}

export interface CallChainEntry {
  depth: number;
  callers: SymbolRef[];
}

export interface CallChainResult {
  symbol: SymbolRef;
  chain: CallChainEntry[];
  truncated: boolean;
}

function findSymbolNodes(graph: CodeGraph, name: string): { id: string; attrs: NodeData }[] {
  const results: { id: string; attrs: NodeData }[] = [];
  graph.graph.forEachNode((id, attrs) => {
    const n = attrs as unknown as NodeData;
    if (n.type === "symbol" && n.label === name) {
      results.push({ id, attrs: n });
    }
  });
  return results;
}

function toSymbolRef(id: string, attrs: NodeData): SymbolRef {
  return { id, name: attrs.label, kind: attrs.kind, file: attrs.file ?? "", line: attrs.line };
}

export function callers(graph: CodeGraph, symbolName: string): CallerResult[] {
  const symbols = findSymbolNodes(graph, symbolName);
  if (symbols.length === 0) return [];

  const results: CallerResult[] = [];
  const seen = new Set<string>();
  for (const sym of symbols) {
    graph.graph.forEachEdge((_key, _eattrs, source, target) => {
      const e = _eattrs as unknown as { relation: string };
      if (target === sym.id && e.relation === "calls") {
        const key = `${source}→${sym.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        const sAttrs = graph.graph.getNodeAttributes(source) as unknown as NodeData;
        results.push({
          caller: toSymbolRef(source, sAttrs),
          callee: toSymbolRef(sym.id, sym.attrs),
        });
      }
    });
  }
  return results;
}

export function callees(graph: CodeGraph, symbolName: string): CalleeResult[] {
  const symbols = findSymbolNodes(graph, symbolName);
  if (symbols.length === 0) return [];

  const results: CalleeResult[] = [];
  const seen = new Set<string>();
  for (const sym of symbols) {
    graph.graph.forEachEdge((_key, _eattrs, source, target) => {
      const e = _eattrs as unknown as { relation: string };
      if (source === sym.id && e.relation === "calls") {
        const key = `${sym.id}→${target}`;
        if (seen.has(key)) return;
        seen.add(key);
        const tAttrs = graph.graph.getNodeAttributes(target) as unknown as NodeData;
        results.push({
          caller: toSymbolRef(sym.id, sym.attrs),
          callee: toSymbolRef(target, tAttrs),
        });
      }
    });
  }
  return results;
}

export function callChain(graph: CodeGraph, symbolName: string, maxDepth = 5): CallChainResult {
  const symbols = findSymbolNodes(graph, symbolName);
  if (symbols.length === 0) {
    return { symbol: { id: "", name: symbolName, file: "" }, chain: [], truncated: false };
  }

  const symbol = toSymbolRef(symbols[0]!.id, symbols[0]!.attrs);
  const chain: CallChainEntry[] = [];
  const visited = new Set<string>();
  const maxPerLevel = 100;
  const maxTotal = 500;
  let totalCount = 0;
  let truncated = false;

  let currentLevel = symbols.map(s => ({ id: s.id }));
  for (const s of symbols) visited.add(s.id);

  while (currentLevel.length > 0 && chain.length < maxDepth) {
    const depth = chain.length + 1;
    const callersAtLevel: { id: string; attrs: NodeData }[] = [];
    const seenAtLevel = new Set<string>();

    for (const node of currentLevel) {
      graph.graph.forEachEdge((_key, _eattrs, source, target) => {
        const e = _eattrs as unknown as { relation: string };
        if (target === node.id && e.relation === "calls" && !visited.has(source)) {
          if (seenAtLevel.has(source)) return;
          seenAtLevel.add(source);
          const sAttrs = graph.graph.getNodeAttributes(source) as unknown as NodeData;
          callersAtLevel.push({ id: source, attrs: sAttrs });
        }
      });
    }

    if (callersAtLevel.length === 0) break;

    const limited = callersAtLevel.slice(0, maxPerLevel);
    if (callersAtLevel.length > maxPerLevel) truncated = true;

    const entry: CallChainEntry = {
      depth,
      callers: limited.map(n => toSymbolRef(n.id, n.attrs)),
    };
    chain.push(entry);
    totalCount += limited.length;

    if (totalCount > maxTotal) {
      truncated = true;
      break;
    }

    for (const n of limited) visited.add(n.id);
    currentLevel = limited;
  }

  return { symbol, chain, truncated };
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
  file?: string | undefined;
  line?: number | undefined;
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
  community?: string | undefined;
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
  kind?: string | undefined;
  file?: string | undefined;
  line?: number | undefined;
}

export interface FileContextResult {
  path: string;
  symbols: { name: string; kind: string; line: number }[];
  exportCount: number;
  dependents: string[];
  imports: string[];
}

export function getFileContext(graph: CodeGraph, filePath: string): FileContextResult | null {
  const fileId = `file::${filePath}`;
  if (!graph.graph.hasNode(fileId)) return null;

  const symbols: { name: string; kind: string; line: number }[] = [];
  graph.graph.forEachNode((id, attrs) => {
    const n = attrs as unknown as NodeData;
    if (n.type === "symbol" && n.file === filePath) {
      symbols.push({ name: n.label, kind: n.kind ?? "unknown", line: n.line ?? 0 });
    }
  });
  symbols.sort((a, b) => a.line - b.line);

  const dependents: string[] = [];
  const imports: string[] = [];
  graph.graph.forEachEdge((_key, _attrs, source, target, srcAttrs) => {
    const e = srcAttrs as unknown as { relation: string };
    if (source === fileId && e.relation === "imports") {
      const tAttrs = graph.graph.getNodeAttributes(target) as unknown as NodeData;
      if (tAttrs.file) imports.push(tAttrs.file);
    }
    if (target === fileId) {
      const sAttrs = graph.graph.getNodeAttributes(source) as unknown as NodeData;
      if (sAttrs.type === "file" && sAttrs.file) dependents.push(sAttrs.file);
    }
  });

  const sortedSymbols = symbols.slice(0, 8);
  const exportCount = symbols.filter(s => s.kind === "export" || s.kind === "function" || s.kind === "class" || s.kind === "const").length;

  return {
    path: filePath,
    symbols: sortedSymbols,
    exportCount,
    dependents: dependents.slice(0, 5),
    imports: imports.slice(0, 5),
  };
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
