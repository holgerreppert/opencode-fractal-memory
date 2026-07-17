import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { resolveNode, wrapWithTracking } from "./shared";

export function MemoryTemporalEdges(store: MemoryStore) {
  const t = tool({
    description: "Retrieve temporal edges for a memory node. Shows connected nodes via NEXT (conversation flow) or DURING_SESSION edges.",
    args: {
      node_id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      direction: tool.schema.enum(["outgoing", "incoming", "both"]).optional(),
      edge_type: tool.schema.string().optional().describe("Filter by edge type (e.g. NEXT, DURING_SESSION)"),
    },
    async execute(args) {
      const node = await resolveNode(store, { id: args.node_id, label: args.label });

      const edges = await store.getTemporalEdges(node.id, args.direction ?? "both", args.edge_type);

      if (edges.length === 0) {
        return `No temporal edges found for **${node.label ?? node.id.slice(0, 8)}**.`;
      }

      const lines: string[] = [
        `## Temporal Edges for ${node.label ?? node.id.slice(0, 8)}`,
        `Direction: ${args.direction ?? "both"}${args.edge_type ? ` | Type: ${args.edge_type}` : ""}`,
        `Found ${edges.length} edge(s)`,
        "",
        "| Type | Direction | Target | Confidence | Created |",
        "|------|-----------|--------|------------|---------|",
      ];

      for (const edge of edges) {
        const dir = edge.sourceNodeId === node.id ? "→ outgoing" : "← incoming";
        const targetLabel = edge.sourceNodeId === node.id ? edge.targetNodeId.slice(0, 12) : edge.sourceNodeId.slice(0, 12);
        const date = new Date(edge.createdAt).toISOString().slice(0, 10);
        lines.push(`| ${edge.edgeType} | ${dir} | \`${targetLabel}\` | ${edge.confidence.toFixed(2)} | ${date} |`);
      }

      lines.push("");
      lines.push("Use `memory(mode=\"get\", id=\"<target-id>\")` to inspect a connected node.");
      lines.push("Use `memory(mode=\"search\", query=\"...\", expand_temporal: true)` to search with temporal context.");

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_temporal_edges");
}
