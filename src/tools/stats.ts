import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { CONTEXT_LIMIT, WARN_THRESHOLD, wrapWithTracking, normalizeScope, boundedContentTokens } from "./shared";
import { isDumpNode } from "../storage/queries/search-helpers";

export function MemoryStats(store: MemoryStore) {
  const t = tool({
    description: "Get fractal memory statistics: nodes per level, compression ratios, fractal dimension, tree structure.",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const scope = normalizeScope(args.scope);
      const stats = await store.getFractalStats(scope, args.project_name);

      const lines: string[] = [
        "## Fractal Memory Statistics",
        "",
        `Total nodes: ${stats.totalNodes}`,
        `Global: ${stats.scopes.global} | Project: ${stats.scopes.project}`,
        "",
        "### Nodes per Level",
        `L0 (raw):     ${stats.nodesPerLevel[0]}`,
        `L1 (weekly):  ${stats.nodesPerLevel[1]}`,
        `L2 (monthly): ${stats.nodesPerLevel[2]}`,
        `L3 (quarter): ${stats.nodesPerLevel[3]}`,
        `L4+ (yearly): ${stats.nodesPerLevel[4] + stats.nodesPerLevel[5]}`,
        "",
        "### Compression Metrics",
        `Fractal dimension: ${stats.fractalDimension}`,
        `Average children per summary: ${stats.avgChildrenPerNode}`,
        `Tree depth: ${stats.treeDepth}`,
        `Nodes with embeddings: ${stats.hasEmbeddings}`,
        "",
        "### Compression Ratios (L0→L1→L2→L3→L4)",
      ];

      const ratios = [
        stats.compressionRatios[0] ?? 0,
        stats.compressionRatios[1] ?? 0,
        stats.compressionRatios[2] ?? 0,
        stats.compressionRatios[3] ?? 0,
        stats.compressionRatios[4] ?? 0,
      ];
      lines.push(ratios.map(r => r > 0 ? `${r.toFixed(1)}x` : "-").join(" → "));

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_stats");
}

export function MemoryInjectionStats(store: MemoryStore) {
  const t = tool({
    description: "Get injection efficiency metrics: tracks how well injected memory is being used by the agent.",
    args: {
      limit: tool.schema.number().min(1).max(1000).optional().describe("Number of recent injections to show (default 10)"),
      session_id: tool.schema.string().optional().describe("Get metrics for specific session only"),
    },
    async execute(args) {
      const limit = args.limit ?? 10;
      
      let metrics: Array<{
        sessionId: string;
        timestamp: number;
        injectedNodeCount: number;
        injectedTokens: number;
        injectionMode: string;
        queryText: string | null;
        preRerankIds: string[] | null;
        postRerankIds: string[] | null;
        rerankScores: number[] | null;
        rerankStrategy: string | null;
        rerankDurationMs: number | null;
        injectedNodeTypes: Record<string, number> | null;
        activeTypeBoosts: Record<string, number> | null;
        toolCalls: number;
        effectivenessScore: number | null;
        injectionUpvotes: number;
        injectionDownvotes: number;
        taskOutcome: string | null;
      }>;
      if (args.session_id) {
        const sessionMetrics = await store.getSessionMetrics(args.session_id);
        if (!sessionMetrics) {
          metrics = [];
        } else {
          metrics = [{
            sessionId: args.session_id,
            timestamp: Date.now(),
            injectedNodeCount: sessionMetrics.totalInjections,
            injectedTokens: 0,
            injectionMode: "session-summary",
            queryText: null,
            preRerankIds: null,
            postRerankIds: null,
            rerankScores: null,
            rerankStrategy: null,
            rerankDurationMs: null,
            injectedNodeTypes: null,
            activeTypeBoosts: null,
            toolCalls: sessionMetrics.totalToolCalls,
            effectivenessScore: sessionMetrics.avgEffectiveness ?? null,
            injectionUpvotes: 0,
            injectionDownvotes: 0,
            taskOutcome: null,
          }];
        }
      } else {
        metrics = await store.getInjectionMetrics(limit);
      }

      if (metrics.length === 0) {
        return "No injection metrics recorded yet. Metrics are collected automatically when memory is injected.";
      }

      // ── Compute derived stats ──
      const totalToolCalls = metrics.reduce((sum, m) => sum + (m.toolCalls ?? 0), 0);
      const avgNodesPerInjection = metrics.reduce((sum, m) => sum + m.injectedNodeCount, 0) / metrics.length;
      const avgEffectiveness = metrics.filter(m => m.effectivenessScore !== null)
        .reduce((sum, m, _, arr) => sum + (m.effectivenessScore ?? 0) / arr.length, 0);

      // Strategy breakdown
      const stratCounts: Record<string, number> = {};
      for (const m of metrics) {
        const s = m.rerankStrategy || (m.injectionMode ? `mode:${m.injectionMode}` : "none");
        stratCounts[s] = (stratCounts[s] || 0) + 1;
      }
      const stratLines = Object.entries(stratCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([s, c]) => `  - ${s}: ${c} injection(s)`);

      // Type distribution
      const typeDist: Record<string, number> = {};
      for (const m of metrics) {
        if (m.injectedNodeTypes) {
          for (const [t, c] of Object.entries(m.injectedNodeTypes)) {
            typeDist[t] = (typeDist[t] ?? 0) + c;
          }
        }
      }
      const typeLines = Object.entries(typeDist)
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `  - ${t}: ${c}`);

      // Score stats
      const allScores: number[] = [];
      for (const m of metrics) {
        if (m.rerankScores) allScores.push(...m.rerankScores);
      }
      let scoreLine = "";
      if (allScores.length > 0) {
        const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
        const min = Math.min(...allScores);
        const max = Math.max(...allScores);
        scoreLine = `Score range: ${min.toFixed(3)} – ${max.toFixed(3)} (avg: ${avg.toFixed(3)})`;
      }

      // Timeline
      const dayCounts: Record<string, number> = {};
      for (const m of metrics) {
        if (m.timestamp) {
          const d = new Date(m.timestamp).toLocaleDateString();
          dayCounts[d] = (dayCounts[d] || 0) + 1;
        }
      }
      const timelineLines = Object.entries(dayCounts)
        .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
        .map(([d, c]) => `  - ${d}: ${c} injection(s)`);

      // ── Build output ──
      const lines: string[] = [
        "## Injection Efficiency Metrics",
        "",
        `Tracking ${metrics.length} injection(s) over ${Object.keys(dayCounts).length} day(s)`,
        "",
        "### Summary",
        `Total tool calls triggered: ${totalToolCalls}`,
        `Avg nodes per injection: ${avgNodesPerInjection.toFixed(1)}`,
        avgEffectiveness > 0 ? `Avg effectiveness score: ${(avgEffectiveness * 100).toFixed(0)}%` : null,
        scoreLine || null,
        "",
        stratLines.length > 0 ? "### Strategy Breakdown" : null,
        ...stratLines,
        stratLines.length > 0 ? "" : null,
        typeLines.length > 0 ? "### Node Types Injected" : null,
        ...typeLines,
        typeLines.length > 0 ? "" : null,
        timelineLines.length > 1 ? "### Injection Timeline" : null,
        ...timelineLines,
        timelineLines.length > 1 ? "" : null,
        "### Recent Injections",
      ].filter(Boolean) as string[];

      for (const m of metrics.slice(0, 5)) {
        const date = m.timestamp ? new Date(m.timestamp).toLocaleString() : "N/A";
        const strategy = m.rerankStrategy || "—";
        const types = m.injectedNodeTypes
          ? Object.entries(m.injectedNodeTypes).map(([t, c]) => `${t}:${c}`).join(", ")
          : "—";
        const effectivenessStr = (m.effectivenessScore !== undefined && m.effectivenessScore !== null)
          ? `, effectiveness: ${(m.effectivenessScore * 100).toFixed(0)}%` : '';
        const query = m.queryText ? ` "${m.queryText.slice(0, 60)}"` : "";
        lines.push(`- ${date}: ${m.injectedNodeCount} nodes | ${strategy} | ${types}${effectivenessStr}${query}`);
      }

      lines.push("");
      lines.push("_Metrics are collected automatically when memory is injected. Use memory(mode=\"verify\") after tasks to improve effectiveness scores._");

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_injection_stats");
}

export function MemoryInjectionFeedback(store: MemoryStore) {
  const t = tool({
    description: "Rate the usefulness of injected memories after completing a task. Upvote helpful injections, downvote irrelevant ones. This helps improve future injection relevance.",
    args: {
      session_id: tool.schema.string().describe("Session ID to provide feedback for (find via learn(mode=\"injection_stats\"))"),
      upvotes: tool.schema.number().min(0).describe("Number of helpful injections"),
      downvotes: tool.schema.number().min(0).describe("Number of irrelevant/inutile injections"),
      task_outcome: tool.schema.enum(["success", "partial", "failed"]).optional().describe("How well the task went"),
      needed_nodes: tool.schema.array(tool.schema.string()).optional().describe("Labels of nodes that would have been helpful but weren't injected"),
    },
    async execute(args) {
      try {
        await store.recordInjectionFeedback(
          args.session_id,
          args.upvotes,
          args.downvotes,
          args.task_outcome,
          args.needed_nodes
        );
        return `Feedback recorded: ${args.upvotes} upvotes, ${args.downvotes} downvotes for session ${args.session_id}`;
      } catch (err) {
        return `Failed to record feedback: ${err}`;
      }
    },
  });
  return wrapWithTracking(t, store, "memory_injection_feedback");
}

export function MemoryCheckContext(store: MemoryStore) {
  const t = tool({
    description: "Check token usage of memory nodes and warn if approaching context limit. Helps decide when to compress or use memory(mode=\"drilldown\").",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      threshold: tool.schema.number().min(0).max(1).optional(),
      node_ids: tool.schema.array(tool.schema.string()).optional(),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const scope = normalizeScope(args.scope);
      const threshold = args.threshold ?? WARN_THRESHOLD;
      let nodes: import("../memory").MemoryNode[] = [];

      if (args.node_ids && args.node_ids.length > 0) {
        for (const id of args.node_ids) {
          try {
            const node = await store.getNode(id);
            nodes.push(node);
          } catch {
            try {
              const prefixNode = await store.getNodeByPrefix(id);
              if (prefixNode) nodes.push(prefixNode);
            } catch { /* skip */ }
          }
        }
      } else {
        nodes = await store.listNodes(scope as "all" | "global" | "project", undefined, undefined, undefined, undefined, args.project_name);
      }

      // Session-dump artifacts (storedcontext / middle-term / [history]) are
      // excluded from context accounting — their content can be huge (up to
      // hundreds of MB) and is preserved via dedicated accessors instead.
      const excluded = nodes.filter(n => isDumpNode(n));
      nodes = nodes.filter(n => !isDumpNode(n));

      const totalTokens = nodes.reduce((sum, n) => sum + boundedContentTokens(n.content, n.summary), 0);
      const ratio = totalTokens / CONTEXT_LIMIT;

      const lines: string[] = [
        "## Memory Context Check",
        "",
        `Total nodes: ${nodes.length}`,
        `Estimated tokens: ${totalTokens.toLocaleString()} / ${CONTEXT_LIMIT.toLocaleString()} (${(ratio * 100).toFixed(1)}%)`,
        "",
      ];

      if (excluded.length > 0) {
        const rawBytes = excluded.reduce((sum, n) => sum + (n.content?.length ?? 0), 0);
        lines.push(`_Excluded ${excluded.length} session-dump node(s) (~${(rawBytes / 1024 / 1024).toFixed(1)} MB raw content). Reachable via memory(mode=list) or context(mode=middle_term)._`);
        lines.push("");
      }

      if (ratio >= threshold) {
        const warningLines = [
          `⚠️ Context at ${(ratio * 100).toFixed(0)}% — above threshold (${(threshold * 100).toFixed(0)}%)`,
          "",
          "To reduce token usage:",
          "- Run memory(mode=\"drilldown\") on specific nodes to get summaries",
          "- Run memory(mode=\"compress\", scope=\"project\", force=true) to create L1 summaries",
          "- Run memory(mode=\"drilldown\") on the created summaries to retrieve compressed content",
        ];

        const nodesByLevel: Record<number, number> = {};
        let rawTokens = 0;
        for (const n of nodes) {
          nodesByLevel[n.level] = (nodesByLevel[n.level] ?? 0) + 1;
          if (n.level === 0) rawTokens += boundedContentTokens(n.content, n.summary);
        }

        if ((nodesByLevel[0] ?? 0) > 0) {
          warningLines.push(`\n${nodesByLevel[0]} L0 nodes (~${rawTokens.toLocaleString()} tokens) could be compressed.`);
        }

        lines.push(...warningLines);
      } else {
        lines.push(`✅ Context at ${(ratio * 100).toFixed(0)}% — below threshold (${(threshold * 100).toFixed(0)}%). No action needed.`);
      }

      if (nodes.length > 0 && nodes.length <= 20) {
        lines.push("", "### Node Breakdown");
        const nodesByLevel: Record<number, typeof nodes> = {};
        for (const n of nodes) {
          if (!nodesByLevel[n.level]) nodesByLevel[n.level] = [];
          nodesByLevel[n.level]!.push(n);
        }
        for (const [level, lvlNodes] of Object.entries(nodesByLevel).sort((a, b) => Number(a[0]) - Number(b[0]))) {
          const lvlTokens = lvlNodes.reduce((s, n) => s + boundedContentTokens(n.content, n.summary), 0);
          lines.push(`L${level}: ${lvlNodes.length} nodes (~${lvlTokens.toLocaleString()} tokens)`);
        }
      }

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_check_context");
}

export function MemoryToolStats(store: MemoryStore) {
  const t = tool({
    description: "Get tool call statistics: usage counts, durations, token output, and efficiency patterns. Shows which tools are fastest and most token-efficient.",
    args: {},
    async execute(_args) {
      const patterns = await store.getToolPatterns("all");

      if (patterns.length === 0) {
        return "No tool call data yet. Statistics are collected automatically as tools are used.";
      }

      const lines: string[] = [
        "## Tool Statistics (last 30 days)",
        "",
        "### Per-Tool Breakdown",
        "",
        "| Tool | Calls | Avg Duration | Avg Tokens | Success |",
        "|------|-------|-------------|------------|---------|",
      ];

      for (const p of patterns) {
        const duration = p.avgDurationMs > 0 ? `${p.avgDurationMs}ms` : "—";
        lines.push(`| ${p.toolName} | ${p.count} | ${duration} | ${p.avgTokens} | ${p.successRate}% |`);
      }

      lines.push("");
      lines.push("### Efficiency Analysis");

      const slowest = patterns.filter(p => p.avgDurationMs > 0).sort((a, b) => b.avgDurationMs - a.avgDurationMs);
      const heaviest = patterns.sort((a, b) => b.avgTokens - a.avgTokens);

      if (slowest.length > 0) {
        const top = slowest[0]!;
        lines.push(`**Slowest:** ${top.toolName} (${top.avgDurationMs}ms avg)`);
      }
      if (heaviest.length > 0) {
        const top = heaviest[0]!;
        lines.push(`**Most tokens:** ${top.toolName} (${top.avgTokens} tokens avg)`);
      }

      const failed = patterns.filter(p => p.successRate < 100);
      if (failed.length > 0) {
        lines.push("**Failures:** " + failed.map(f => `${f.toolName} (${100 - f.successRate}%)`).join(", "));
      }

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_tool_stats");
}