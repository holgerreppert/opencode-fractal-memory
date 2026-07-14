import type { MemConfig } from "../../infrastructure/config/config";
import { ensureBackgroundGraph, getActiveGraph, buildGraph } from "../../application/graph/build";
import { getFileContext } from "../../application/graph/query";
import { extractSkeleton } from "../../application/skeletonize";
import { writeGraphLog } from "../../logging";
import type { HookHandler } from "./types";

function hasGraph(graph: ReturnType<typeof getActiveGraph>): boolean {
  return graph !== null && graph.nodeCount() >= 10;
}

export function createGraphContextHandler(config: MemConfig): HookHandler {
  const graphConfig = config.graph;
  if (!graphConfig?.enabled) return {};

  const root = process.cwd();
  const maxFiles = graphConfig.maxFiles ?? 5000;
  const autoSkeletonMinLines = graphConfig.autoSkeletonizeMinLines;

  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: { filePath?: string; offset?: number } };
      if (input.tool !== "read") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      if (input.args?.offset) return;

      const out = output as { output?: string };
      const raw = typeof out.output === "string" ? out.output : "";
      if (!raw) return;

      let preamble = "";

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
        }
      }

      if (graph) {
        const context = getFileContext(graph, filePath);
        if (context) {
          const graphLines: string[] = [];
          if (context.imports.length > 0) {
            graphLines.push("# imports:");
            for (const imp of context.imports.slice(0, 10)) {
              graphLines.push(`#   ${imp}`);
            }
          }
          if (context.symbols.length > 0) {
            graphLines.push("# symbols:");
            for (const sym of context.symbols.slice(0, 15)) {
              graphLines.push(`#   ${sym.kind} ${sym.name} [line ${sym.line}]`);
            }
          }
          if (context.dependents.length > 0) {
            graphLines.push("# depended on by:");
            for (const dep of context.dependents.slice(0, 10)) {
              graphLines.push(`#   ${dep}`);
            }
          }
          if (graphLines.length > 0) {
            preamble += graphLines.join("\n") + "\n\n";
            writeGraphLog("info", "Graph context injected on read", { file: filePath, lines: graphLines.length });
          }
        }
      }

      if (autoSkeletonMinLines > 0) {
        const lineCount = raw.split("\n").length;
        if (lineCount >= autoSkeletonMinLines) {
          try {
            const skeleton = extractSkeleton(filePath, raw);
            if (skeleton) {
              preamble += skeleton + "\n\n";
              writeGraphLog("info", "Auto-skeleton injected on read", { file: filePath, lines: lineCount });
            }
          } catch {
            writeGraphLog("warn", "Auto-skeleton failed", { file: filePath });
          }
        }
      }

      if (preamble) {
        out.output = preamble + raw;
      }
    },
  };
}
