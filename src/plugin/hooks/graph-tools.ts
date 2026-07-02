import type { MemConfig } from "../../infrastructure/config/config";
import { ensureBackgroundGraph, getBackgroundGraph } from "../../application/graph/build";
import { trackRuleInjection } from "../../application/graph/usage";
import type { HookHandler } from "./types";

const READ_TOOLS = new Set(["read", "grep", "glob", "Grep", "Glob"]);

export function createGraphToolsHandler(config: MemConfig): HookHandler {
  const graphConfig = config.graph ?? { enabled: false, maxFiles: 5000 };

  if (!graphConfig.enabled) return {};

  const root = process.cwd();
  const maxFiles = graphConfig.maxFiles ?? 5000;

  ensureBackgroundGraph(root, maxFiles);

  return {
    "system.transform": async (_input: unknown, output: { system: string[] }) => {
      const graph = getBackgroundGraph();
      if (!graph || graph.nodeCount() === 0) return;

      trackRuleInjection("plugin-hook");
      const stats = `${graph.nodeCount()} nodes, ${graph.edgeCount()} edges`;
      const rule = `<system_reminder type="info">
Before reading source files or searching with grep, first use the code graph tools:
- \`graph_search("symbolName")\` — find symbol locations by name or file path
- \`graph_explain("nodeId")\` — explore a symbol's dependencies and neighbors
- \`graph_path("fromId", "toId")\` — trace dependency paths between two nodes

If the graph isn't built yet, call \`graph_build()\` first. Current graph: ${stats}
</system_reminder>`;

      const insertAt = output.system.length > 0 ? 1 : 0;
      output.system.splice(insertAt, 0, rule);
    },

    "tool.before": async (_input: unknown, _output: unknown) => {
      const input = _input as { tool?: string };
      if (!input.tool || !READ_TOOLS.has(input.tool)) return;
      if (!getBackgroundGraph()) {
        ensureBackgroundGraph(root, maxFiles);
      }
    },
  };
}
