import { tool } from "@opencode-ai/plugin";
import { getActiveGraph, ensureBackgroundGraph, buildGraph } from "../application/graph/build";
import type { CodeGraph } from "../application/graph/graph";
import { callers, callees, callChain, searchNodes, explain, shortestPath, getFileContext } from "../application/graph/query";
import { trackGraphTool } from "../application/graph/usage";
import { memLog } from "../logging";
import { wrapWithTracking } from "./shared";

export type GraphRelation = "callers" | "callees" | "call_chain" | "imports" | "dependents" | "search" | "explain" | "path";

export interface GraphToolParams {
  relation: GraphRelation;
  name?: string;
  file?: string;
  depth?: number;
  query?: string;
  from?: string;
  to?: string;
  id?: string;
  limit?: number;
}

export interface GraphToolResult {
  relation: GraphRelation;
  results: unknown;
  truncated: boolean;
  error?: string;
}

function hasGraph(graph: CodeGraph | null): graph is CodeGraph {
  return graph !== null && graph.nodeCount() >= 10;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSymbols(items: any[]): unknown[] {
  return items.map((i: { name: string; file: string; line?: number; kind?: string }) => ({
    name: i.name,
    kind: i.kind ?? "unknown",
    file: i.file,
    line: i.line ?? 0,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCallResults(results: any[]): unknown[] {
  return results.map((r: { caller: { name: string; file: string; line?: number; kind?: string }; callee: { name: string; file: string; line?: number; kind?: string } }) => ({
    caller: {
      name: r.caller.name,
      kind: r.caller.kind ?? "unknown",
      file: r.caller.file,
      line: r.caller.line ?? 0,
    },
    callee: {
      name: r.callee.name,
      kind: r.callee.kind ?? "unknown",
      file: r.callee.file,
      line: r.callee.line ?? 0,
    },
  }));
}

export function executeGraphTool(params: GraphToolParams): GraphToolResult {
  let graph = getActiveGraph();

  if (!hasGraph(graph)) {
    ensureBackgroundGraph(process.cwd());
    graph = getActiveGraph();
  }
  if (!hasGraph(graph)) {
    try {
      const result = buildGraph(process.cwd(), 5000);
      graph = result.graph;
    } catch {
      return { relation: params.relation, results: [], truncated: false, error: "Graph build failed. Check logs for details." };
    }
  }

  trackGraphTool(params.relation, "graph-tool");

  try {
    switch (params.relation) {
      case "callers": {
        if (!params.name) return { relation: "callers", results: [], truncated: false, error: "name is required for callers" };
        const result = callers(graph, params.name);
        return { relation: "callers", results: formatCallResults(result.slice(0, params.limit ?? 200)), truncated: result.length > (params.limit ?? 200) };
      }
      case "callees": {
        if (!params.name) return { relation: "callees", results: [], truncated: false, error: "name is required for callees" };
        const result = callees(graph, params.name);
        return { relation: "callees", results: formatCallResults(result.slice(0, params.limit ?? 200)), truncated: result.length > (params.limit ?? 200) };
      }
      case "call_chain": {
        if (!params.name) return { relation: "call_chain", results: [], truncated: false, error: "name is required for call_chain" };
        const depth = params.depth ?? 5;
        const result = callChain(graph, params.name, depth);
        return {
          relation: "call_chain",
          results: {
            symbol: { name: result.symbol.name, kind: result.symbol.kind ?? "unknown", file: result.symbol.file, line: result.symbol.line ?? 0 },
            chain: result.chain.map(e => ({
              depth: e.depth,
              callers: formatSymbols(e.callers),
            })),
          },
          truncated: result.truncated,
        };
      }
      case "imports": {
        if (!params.file) return { relation: "imports", results: [], truncated: false, error: "file is required for imports" };
        const context = getFileContext(graph, params.file);
        if (!context) return { relation: "imports", results: [], truncated: false, error: `File not found in graph: ${params.file}` };
        return { relation: "imports", results: context.imports, truncated: false };
      }
      case "dependents": {
        if (!params.file) return { relation: "dependents", results: [], truncated: false, error: "file is required for dependents" };
        const context = getFileContext(graph, params.file);
        if (!context) return { relation: "dependents", results: [], truncated: false, error: `File not found in graph: ${params.file}` };
        return { relation: "dependents", results: context.dependents, truncated: false };
      }
      case "search": {
        if (!params.query) return { relation: "search", results: [], truncated: false, error: "query is required for search" };
        const result = searchNodes(graph, params.query);
        const limit = params.limit ?? 50;
        return {
          relation: "search",
          results: result.slice(0, limit).map(n => ({
            id: n.id,
            name: n.label,
            kind: n.kind ?? n.type,
            file: n.file ?? "",
            line: n.line ?? 0,
          })),
          truncated: result.length > limit,
        };
      }
      case "explain": {
        if (!params.id) return { relation: "explain", results: [], truncated: false, error: "id is required for explain" };
        const result = explain(graph, params.id);
        if (!result) return { relation: "explain", results: [], truncated: false, error: `Node not found: ${params.id}` };
        return {
          relation: "explain",
          results: {
            node: { name: result.node.label, kind: result.node.kind ?? result.node.type, file: result.node.file ?? "", line: result.node.line ?? 0 },
            degree: result.degree,
            community: result.community,
            neighbors: result.neighbors.map(n => ({
              name: n.label,
              relation: n.relation,
              file: n.file ?? "",
              line: n.line ?? 0,
            })),
          },
          truncated: false,
        };
      }
      case "path": {
        if (!params.from || !params.to) return { relation: "path", results: [], truncated: false, error: "from and to are required for path" };
        const result = shortestPath(graph, params.from, params.to);
        if (!result) return { relation: "path", results: [], truncated: false, error: "No path found" };
        return {
          relation: "path",
          results: {
            path: result.path.map(p => ({ name: p.label, file: p.file ?? "", line: p.line ?? 0 })),
            length: result.length,
          },
          truncated: false,
        };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    memLog("error", "graph-tool", `Execution failed`, { relation: params.relation, error: msg });
    return { relation: params.relation, results: [], truncated: false, error: msg };
  }
}

export function createGraphPluginTool() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = tool({
    description: `USE INSTEAD OF grep/glob/read — 10-100x more token-efficient for code exploration.

WHEN TO USE (ordered by priority):
  INSTEAD OF grep/glob — search(relation="search", query="<name>") finds symbols at ~1% the token cost
  BEFORE editing —      callers(relation="callers", name="<fn>") who depends on this
  AFTER a symbol —      callees(relation="callees", name="<fn>") what does it call
  Change impact —       dependents(relation="dependents", file="<path>") who imports this
  Trace deps —          call_chain(relation="call_chain", name="<fn>", depth=3) transitive callers
  INSTEAD OF read —     imports(relation="imports", file="<path>") understand a file's role
  Explore —             explain(relation="explain", id="<node-id>") all neighbors
  Shortest path —       path(relation="path", from="<id>", to="<id>") dep chain between nodes

Relations:
  callers     — who calls this symbol name?
  callees     — what does this symbol call?
  call_chain  — transitive callers up to N depth (BFS)
  imports     — what modules/paths does this file import?
  dependents  — what files import this module/path?
  search      — find graph nodes by name or file path
  explain     — get all neighbors of a graph node by ID
  path        — shortest path between two nodes by ID`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: {} as any,
    async execute(args: Record<string, unknown>) {
      const result = executeGraphTool(args as unknown as GraphToolParams);
      return { output: JSON.stringify(result, null, 2) };
    },
  });
  return wrapWithTracking(t, null, "graph");
}
