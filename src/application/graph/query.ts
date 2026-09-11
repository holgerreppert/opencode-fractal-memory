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
  const g = graph.graph as any;
  g.forEachNode((id: string, attrs: any) => {
    const n = attrs as unknown as NodeData;
    if (n.type === "symbol" && n.label === name) results.push({ id, attrs: n });
  });
  return results;
}

function toSymbolRef(id: string, attrs: NodeData): SymbolRef {
  return { id, name: attrs.label, kind: attrs.kind, file: attrs.file ?? "", line: attrs.line };
}

export function callers(graph: CodeGraph, symbolName: string): CallerResult[] {
  const symbols = findSymbolNodes(graph, symbolName);
  if (symbols.length === 0) return [];
  const g = graph.graph as any;
  const results: CallerResult[] = [];
  const seen = new Set<string>();
  const useIn = typeof g.forEachInEdge === "function";
  for (const sym of symbols) {
    const handle = (source: string) => {
      const key = `${source}→${sym.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const sAttrs = g.getNodeAttributes(source) as unknown as NodeData;
      results.push({ caller: toSymbolRef(source, sAttrs), callee: toSymbolRef(sym.id, sym.attrs) });
    };
    if (useIn) {
      g.forEachInEdge(sym.id, (_key: string, _eattrs: any, source: string) => {
        const e = _eattrs as unknown as { relation: string };
        if (e.relation === "calls") handle(source);
      });
    } else {
      g.forEachEdge((_key: string, _eattrs: any, source: string, target: string) => {
        const e = _eattrs as unknown as { relation: string };
        if (target === sym.id && e.relation === "calls") handle(source);
      });
    }
  }
  return results;
}

export function callees(graph: CodeGraph, symbolName: string): CalleeResult[] {
  const symbols = findSymbolNodes(graph, symbolName);
  if (symbols.length === 0) return [];
  const g = graph.graph as any;
  const results: CalleeResult[] = [];
  const seen = new Set<string>();
  const useOut = typeof g.forEachOutEdge === "function";
  for (const sym of symbols) {
    const handle = (target: string) => {
      const key = `${sym.id}→${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      const tAttrs = g.getNodeAttributes(target) as unknown as NodeData;
      results.push({ caller: toSymbolRef(sym.id, sym.attrs), callee: toSymbolRef(target, tAttrs) });
    };
    if (useOut) {
      g.forEachOutEdge(sym.id, (_key: string, _eattrs: any, _src: string, target: string) => {
        const e = _eattrs as unknown as { relation: string };
        if (e.relation === "calls") handle(target);
      });
    } else {
      g.forEachEdge((_key: string, _eattrs: any, source: string, target: string) => {
        const e = _eattrs as unknown as { relation: string };
        if (source === sym.id && e.relation === "calls") handle(target);
      });
    }
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

  const g = graph.graph as any;
  const useIn = typeof g.forEachInEdge === "function";
  for (const node of currentLevel) {
    const visit = (source: string, eattrs: any) => {
      const e = eattrs as unknown as { relation: string };
      if (e.relation !== "calls" || visited.has(source) || seenAtLevel.has(source)) return;
      seenAtLevel.add(source);
      const sAttrs = g.getNodeAttributes(source) as unknown as NodeData;
      callersAtLevel.push({ id: source, attrs: sAttrs });
    };
    if (useIn) {
      g.forEachInEdge(node.id, (_key: string, _eattrs: any, source: string) => visit(source, _eattrs));
    } else {
      g.forEachEdge((_key: string, _eattrs: any, source: string, target: string) => {
        if (target === node.id) visit(source, _eattrs);
      });
    }
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

export function shortestPath(graph: CodeGraph, fromId: string, toId: string): PathResult | null {
  const g = graph.graph as any;
  if (!g.hasNode(fromId) || !g.hasNode(toId)) return null;
  try {
    const path = bidirectional(graph.graph, fromId, toId);
    if (!path) return null;
    return {
      path: path.map((id: string) => {
        const attrs = g.getNodeAttributes(id) as unknown as NodeData;
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
  const g = graph.graph as any;
  if (!g.hasNode(nodeId)) return [];
  const results: NeighborResult[] = [];
  const useIn = typeof g.forEachInEdge === "function";
  const useOut = typeof g.forEachOutEdge === "function";
  if (useIn && useOut) {
    g.forEachOutEdge(nodeId, (_k: string, attrs: any, _s: string, target: string) => {
      const nAttrs = g.getNodeAttributes(target) as unknown as NodeData;
      const e = attrs as unknown as { relation: string };
      results.push({ id: target, label: nAttrs.label, relation: e.relation, file: nAttrs.file, line: nAttrs.line });
    });
    g.forEachInEdge(nodeId, (_k: string, attrs: any, source: string) => {
      const nAttrs = g.getNodeAttributes(source) as unknown as NodeData;
      const e = attrs as unknown as { relation: string };
      results.push({ id: source, label: nAttrs.label, relation: `inverse_${e.relation}`, file: nAttrs.file, line: nAttrs.line });
    });
  } else {
    g.forEachEdge((_key: string, attrs: any, source: string, target: string) => {
      if (source !== nodeId && target !== nodeId) return;
      const neighborId = source === nodeId ? target : source;
      const nAttrs = g.getNodeAttributes(neighborId) as unknown as NodeData;
      const edgeAttrs = attrs as unknown as { relation: string };
      results.push({ id: neighborId, label: nAttrs.label, relation: source === nodeId ? edgeAttrs.relation : `inverse_${edgeAttrs.relation}`, file: nAttrs.file, line: nAttrs.line });
    });
  }
  return results;
}

export interface ExplainResult {
  node: NodeData;
  neighbors: NeighborResult[];
  degree: number;
  community?: string | undefined;
}

export function explain(graph: CodeGraph, nodeId: string): ExplainResult | null {
  const g = graph.graph as any;
  if (!g.hasNode(nodeId)) return null;
  const attrs = g.getNodeAttributes(nodeId) as unknown as NodeData;
  return { node: attrs, neighbors: getNeighbors(graph, nodeId), degree: g.degree(nodeId), community: attrs.community };
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
  const g = graph.graph as any;
  const fileId = `file::${filePath}`;
  if (!g.hasNode(fileId)) return null;
  const symbols: { name: string; kind: string; line: number }[] = [];
  g.forEachNode((id: string, attrs: any) => {
    const n = attrs as unknown as NodeData;
    if (n.type === "symbol" && n.file === filePath) symbols.push({ name: n.label, kind: n.kind ?? "unknown", line: n.line ?? 0 });
  });
  symbols.sort((a, b) => a.line - b.line);

  const dependents: string[] = [];
  const imports: string[] = [];
  const useIn = typeof g.forEachInEdge === "function";
  const useOut = typeof g.forEachOutEdge === "function";
  if (useIn && useOut) {
    g.forEachOutEdge(fileId, (_k: string, attrs: any, _s: string, target: string) => {
      const e = attrs as unknown as { relation: string };
      if (e.relation === "imports") {
        const tAttrs = g.getNodeAttributes(target) as unknown as NodeData;
        if (tAttrs.file) imports.push(tAttrs.file);
      }
    });
    g.forEachInEdge(fileId, (_k: string, _attrs: any, source: string) => {
      const sAttrs = g.getNodeAttributes(source) as unknown as NodeData;
      if (sAttrs.type === "file" && sAttrs.file) dependents.push(sAttrs.file);
    });
  } else {
    g.forEachEdge((_key: string, _attrs: any, source: string, target: string, srcAttrs: any) => {
      const e = srcAttrs as unknown as { relation: string };
      if (source === fileId && e.relation === "imports") {
        const tAttrs = g.getNodeAttributes(target) as unknown as NodeData;
        if (tAttrs.file) imports.push(tAttrs.file);
      }
      if (target === fileId) {
        const sAttrs = g.getNodeAttributes(source) as unknown as NodeData;
        if (sAttrs.type === "file" && sAttrs.file) dependents.push(sAttrs.file);
      }
    });
  }

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
  const g = graph.graph as any;
  g.forEachNode((id: string, attrs: any) => {
    const n = attrs as unknown as NodeData;
    if (n.label.toLowerCase().includes(q) || n.file?.toLowerCase().includes(q)) {
      results.push({ id, label: n.label, type: n.type, kind: n.kind, file: n.file, line: n.line });
    }
  });
  return results;
}
