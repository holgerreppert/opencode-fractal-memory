import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import type { MemoryNode } from "../memory";
import { wrapWithTracking } from "./shared";

export function MemoryDashboard(store: MemoryStore) {
  const t = tool({
    description: "Display memory dashboard with top nodes by usefulness, type distribution, and recent activity.",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      limit: tool.schema.number().min(1).max(100).optional(),
      show_tree_depth: tool.schema.boolean().optional(),
      show_embedding_coverage: tool.schema.boolean().optional(),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (defaults to current project)"),
    },
    async execute(args) {
      const scope = (args.scope ?? "all") as "all" | "global" | "project";
      const limit = args.limit ?? 10;
      const showTreeDepth = args.show_tree_depth ?? true;
      const showEmbeddingCoverage = args.show_embedding_coverage ?? true;

      const effectiveProjectName = args.project_name ?? store.projectName;
      const [allNodes, stats] = await Promise.all([
        store.listNodes(scope, undefined, undefined, undefined, undefined, effectiveProjectName),
        store.getFractalStats(scope, effectiveProjectName),
      ]);

      if (allNodes.length === 0) {
        return "## Memory Dashboard\n\nNo nodes found in the specified scope.";
      }

      const lines: string[] = [
        "## Memory Dashboard",
        `Scope: ${scope} | Total nodes: ${allNodes.length}`,
        "",
      ];

      // 1. Top nodes by access count
      const topByAccess = [...allNodes]
        .sort((a, b) => b.accessCount - a.accessCount)
        .slice(0, limit);

      lines.push("### Top Nodes by Access Count");
      lines.push("| Rank | Label | Access Count | Usefulness | Times Used | Level |");
      lines.push("|------|-------|-------------|------------|------------|-------|");
      topByAccess.forEach((n, i) => {
        const label = n.label ?? n.id.slice(0, 8);
        lines.push(`| ${i + 1} | ${label} | ${n.accessCount} | ${n.usefulnessScore?.toFixed(1) ?? "-"} | ${n.timesUsed ?? 0} | L${n.level} |`);
      });
      lines.push("");

      // 2. Type distribution
      const typeCount = new Map<string, number>();
      for (const n of allNodes) {
        const t = n.type ?? "none";
        typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
      }

      lines.push("### Type Distribution");
      lines.push("| Type | Count |");
      lines.push("|------|-------|");
      for (const [type, count] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${type} | ${count} |`);
      }
      lines.push("");

      // 3. Compression Health
      lines.push("### Compression Health");
      const stickyCount = allNodes.filter(n => n.sticky).length;
      lines.push(`- Fractal dimension: ${stats.fractalDimension}`);
      if (showTreeDepth) {
        lines.push(`- Tree depth: ${stats.treeDepth}`);
      }
      lines.push(`- Average children per summary: ${stats.avgChildrenPerNode?.toFixed(1) ?? "-"}`);
      lines.push(`- Sticky nodes: ${stickyCount}`);
      if (showEmbeddingCoverage) {
        const withEmbeddings = allNodes.filter(n => n.embedding).length;
        const pct = allNodes.length > 0 ? ((withEmbeddings / allNodes.length) * 100).toFixed(0) : "0";
        lines.push(`- Nodes with embeddings: ${withEmbeddings}/${allNodes.length} (${pct}%)`);
      }
      lines.push("");

      // Compression ratios
      const ratios = [
        stats.compressionRatios[0] ?? 0,
        stats.compressionRatios[1] ?? 0,
        stats.compressionRatios[2] ?? 0,
        stats.compressionRatios[3] ?? 0,
        stats.compressionRatios[4] ?? 0,
      ];
      const ratioStr = ratios.map(r => r > 0 ? `${r.toFixed(1)}x` : "-").join(" → ");
      lines.push(`- Compression ratios (L0→L4): ${ratioStr}`);
      lines.push("");

      // 4. Usefulness tracking
      const topUseful = [...allNodes]
        .sort((a, b) => (b.usefulnessScore ?? 0) - (a.usefulnessScore ?? 0))
        .slice(0, Math.min(limit, 5));

      lines.push("### Most Useful Nodes");
      lines.push("| Label | Usefulness | Times Used | Times Helpful |");
      lines.push("|-------|------------|------------|---------------|");
      for (const n of topUseful) {
        if ((n.usefulnessScore ?? 0) > 0) {
          const label = n.label ?? n.id.slice(0, 8);
          lines.push(`| ${label} | ${n.usefulnessScore?.toFixed(1) ?? "-"} | ${n.timesUsed ?? 0} | ${n.timesHelpful ?? 0} |`);
        }
      }

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_dashboard");
}
