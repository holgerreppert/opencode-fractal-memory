import { ensureBackgroundGraph, getActiveGraph, buildGraph } from "../../application/graph/build";
import { searchNodes } from "../../application/graph/query";
import type { MemConfig } from "../../infrastructure/config/config";
import { writeGraphLog } from "../../logging";
import type { HookHandler } from "./types";

const SEARCH_TOOLS = new Set(["grep", "glob", "search"]);

function hasGraph(graph: ReturnType<typeof getActiveGraph>): boolean {
  return graph !== null && graph.nodeCount() >= 10;
}

export function createGraphSearchHintHandler(config: MemConfig): HookHandler {
  const graphConfig = config.graph;
  if (!graphConfig?.enabled) return {};

  const root = process.cwd();
  const maxFiles = graphConfig.maxFiles ?? 5000;

  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: Record<string, unknown> };
      if (!input.tool || !SEARCH_TOOLS.has(input.tool)) return;

      const query = (input.args?.query ?? input.args?.pattern ?? input.args?.text ?? "") as string;
      if (!query || query.length < 2) return;

      let graph = getActiveGraph();
      if (!hasGraph(graph)) {
        ensureBackgroundGraph(root, maxFiles);
        graph = getActiveGraph();
      }
      if (!hasGraph(graph)) {
        try {
          const result = buildGraph(root, maxFiles);
          graph = result.graph;
        } catch {
          return;
        }
      }
      if (!graph) return;

      const matches = searchNodes(graph, query).filter(n => n.type === "symbol");
      if (matches.length === 0) return;

      const suggestions = matches.slice(0, 3).map(m => {
        const loc = m.file ? ` in ${m.file.split("/").pop()}:${m.line}` : "";
        return `${m.label} (${m.kind ?? m.type})${loc}`;
      });

      const hint = `\n\n# Also in code graph: ${suggestions.join(", ")} — use skeletonize(path) or graph(explain, id=...) for details`;

      writeGraphLog("info", "Search hint injected", { tool: input.tool, query, matches: matches.length });

      const out = output as { output?: string };
      if (typeof out.output === "string" && !out.output.includes("code graph")) {
        out.output += hint;
      }
    },
  };
}
