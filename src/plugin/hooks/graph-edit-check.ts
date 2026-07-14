import type { MemConfig } from "../../infrastructure/config/config";
import { ensureBackgroundGraph, getActiveGraph, buildGraph } from "../../application/graph/build";
import { getFileContext } from "../../application/graph/query";
import { writeGraphLog } from "../../logging";
import type { HookHandler } from "./types";

function hasGraph(graph: ReturnType<typeof getActiveGraph>): boolean {
  return graph !== null && graph.nodeCount() >= 10;
}

export function createGraphEditCheckHandler(config: MemConfig): HookHandler {
  const graphConfig = config.graph;
  if (!graphConfig?.enabled) return {};

  const root = process.cwd();
  const maxFiles = graphConfig.maxFiles ?? 5000;

  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: { filePath?: string } };
      if (input.tool !== "edit" && input.tool !== "write") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      let graph = getActiveGraph();
      if (!hasGraph(graph)) {
        ensureBackgroundGraph(root, maxFiles);
        graph = getActiveGraph();
      }
      if (!hasGraph(graph)) {
        try {
          const result = buildGraph(root, maxFiles);
          graph = result.graph;
          writeGraphLog("info", "Graph built for edit check", { files: result.fileCount });
        } catch {
          return;
        }
      }

      if (!graph) return;

      const context = getFileContext(graph, filePath);
      if (!context || context.dependents.length === 0) return;

      const warning = `\n\n⚠️  This file has ${context.dependents.length} dependent(s). Changes may affect:\n${context.dependents.slice(0, 8).map(d => `   - ${d}`).join("\n")}`;

      writeGraphLog("info", "Edit dependency warning injected", { file: filePath, dependents: context.dependents.length });

      const out = output as { output?: string };
      if (typeof out.output === "string") {
        out.output += warning;
      }
    },
  };
}
