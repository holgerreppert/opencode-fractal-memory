import type { MemConfig } from "../../infrastructure/config/config";
import { ensureBackgroundGraph, getActiveGraph, buildGraph } from "../../application/graph/build";
import { getFileContext } from "../../application/graph/query";
import { writeGraphLog } from "../../logging";
import type { HookHandler } from "./types";

function hasGraph(graph: ReturnType<typeof getActiveGraph>): boolean {
  return graph !== null && graph.nodeCount() >= 10;
}

export function createGraphContextHandler(config: MemConfig): HookHandler {
  const graphConfig = config.graph ?? { enabled: false, maxFiles: 5000, refreshEnabled: true };
  if (!graphConfig.enabled) return {};

  const root = process.cwd();
  const maxFiles = graphConfig.maxFiles ?? 5000;

  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: { filePath?: string; offset?: number } };
      if (input.tool !== "read") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      if (input.args?.offset) return;

      let graph = getActiveGraph();
      if (!hasGraph(graph)) {
        ensureBackgroundGraph(root, maxFiles);
        graph = getActiveGraph();
      }
      if (!hasGraph(graph)) {
        try {
          const result = buildGraph(root, maxFiles);
          graph = result.graph;
          writeGraphLog("info", "Graph built for preamble", { files: result.fileCount });
        } catch {
          writeGraphLog("warn", "Graph preamble: synchronous build failed", { file: filePath });
          return;
        }
      }

      if (!graph) return;

      const context = getFileContext(graph, filePath);
      if (!context) return;

      const lines: string[] = [];

      if (context.imports.length > 0) {
        lines.push("# imports:");
        for (const imp of context.imports.slice(0, 10)) {
          lines.push(`#   ${imp}`);
        }
      }

      if (context.symbols.length > 0) {
        lines.push("# symbols:");
        for (const sym of context.symbols.slice(0, 15)) {
          lines.push(`#   ${sym.kind} ${sym.name} [line ${sym.line}]`);
        }
      }

      if (context.dependents.length > 0) {
        lines.push("# depended on by:");
        for (const dep of context.dependents.slice(0, 10)) {
          lines.push(`#   ${dep}`);
        }
      }

      if (lines.length === 0) return;

      const preamble = lines.join("\n") + "\n\n";
      writeGraphLog("info", "Graph context injected on read", { file: filePath, lines: lines.length });

      const out = output as { output?: string };
      if (typeof out.output === "string") {
        out.output = preamble + out.output;
      }
    },
  };
}
