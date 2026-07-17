import { getActiveGraph } from "../../application/graph/build";
import { searchNodes, getFileContext } from "../../application/graph/query";
import type { HookHandler } from "./types";

function hasGraph(graph: ReturnType<typeof getActiveGraph>): graph is NonNullable<ReturnType<typeof getActiveGraph>> {
  return graph !== null && graph.nodeCount() >= 10;
}

function extractGrepQuery(command: string): string | null {
  const trimmed = command.trim();
  const grepMatch = /^(?:grep|rg|ripgrep|ag)\b.*?['"]?([a-zA-Z_]\w{2,})['"]?/.exec(trimmed);
  if (grepMatch) return grepMatch[1]!;
  return null;
}

export function createToolBeforeGuardHandler(): HookHandler {
  return {
    "tool.before": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: Record<string, unknown> };
      const tool = input.tool;
      if (!tool) return;

      const graph = getActiveGraph();
      if (!hasGraph(graph)) return;

      const out = output as { output?: string };
      let hint = "";

      if (tool === "read") {
        const filePath = input.args?.filePath as string | undefined;
        if (!filePath) return;
        const context = getFileContext(graph, filePath);
        if (context && context.imports.length + context.symbols.length + context.dependents.length > 0) {
          hint = `[cost-saver] This file is in the code graph. Use graph(imports, file=...) or graph(dependents, file=...) instead — 10-100x fewer tokens for the same structural understanding. Use skeletonize(path) for a compact symbol overview.`;
        }
      } else if (tool === "grep" || tool === "glob") {
        const query = (input.args?.query ?? input.args?.pattern ?? "") as string;
        if (!query || query.length < 2) return;
        const matches = searchNodes(graph, query).filter(n => n.type === "symbol");
        if (matches.length > 0) {
          hint = `[cost-saver] graph(search, query="${query}") found ${matches.length} matching symbols in the code graph — faster and more token-efficient than ${tool}.`;
        }
      } else if (tool === "bash") {
        const command = (input.args?.command ?? "") as string;
        const grepQuery = extractGrepQuery(command);
        if (grepQuery) {
          const matches = searchNodes(graph, grepQuery).filter(n => n.type === "symbol");
          if (matches.length > 0) {
            hint = `[cost-saver] graph(search, query="${grepQuery}") found ${matches.length} matching symbols — more efficient than grep in bash.`;
          }
        }
      }

      if (hint) {
        if (typeof out.output === "string") {
          out.output = hint + "\n\n" + out.output;
        } else {
          out.output = hint;
        }
      }
    },
  };
}
