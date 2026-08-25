import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import type { MemoryDomain, MemoryNodeLevel, MemoryNodeType, MemorySubtask } from "../storage/types";
import { estimateTokens, generateEmbedding } from "../infrastructure/llm/embeddings";
import { searchNodes } from "../application/search";
import { resolveNode, wrapWithContextWarning, wrapWithTracking, lastSearchResults } from "./shared";

export function MemoryDrilldown(store: MemoryStore) {
  const t = tool({
    description: "Retrieve a memory node with path to source nodes (fractal retrieval).",
    args: {
      id: tool.schema.string().optional().describe("Node ID to drill down from"),
      label: tool.schema.string().optional().describe("Node label to drill down from"),
      scope: tool.schema.enum(["global", "project"]).optional().describe("Scope of the node"),
      max_depth: tool.schema.number().int().nonnegative().optional().describe("Maximum depth to traverse (default 10)"),
    },
    async execute(args) {
      const node = await resolveNode(store, args);
      const nodeId = node.id;

      const result = await store.retrieveFractal(nodeId, args.max_depth ?? 10);
      
      const catInfo = result.node.category ? ` | Category: ${result.node.category}` : "";
      const lines: string[] = [
        `## Fractal Retrieval: ${result.node.label ?? result.node.id.slice(0, 8)}`,
        `Level: ${result.node.level} | Depth: ${result.depth} | Relevance: ${result.relevanceScore.toFixed(2)}${catInfo}`,
        "",
        "### Path (current → sources)",
        ...result.path.map((n, i) => {
          const indent = "  ".repeat(i);
          const marker = i === 0 ? "→" : "↳";
          return `${indent}${marker} [L${n.level}] ${n.label ?? n.id.slice(0, 8)}${n.content.length > 50 ? "..." : ""}`;
        }),
        "",
        "### Full Content",
        result.node.content,
      ];

      const scope = args.scope ?? (result.node.scope as "global" | "project");
      const linkedNodes = await store.getLinkedNodes(scope, nodeId);
      if (linkedNodes.length > 0) {
        lines.push("", "### Linked Nodes");
        for (const linked of linkedNodes) {
          lines.push(`- [[${linked.label ?? linked.id.slice(0, 8)}]]: ${linked.content.slice(0, 100)}${linked.content.length > 100 ? "..." : ""}`);
        }
      }

      const resultStr = lines.join("\n");
      const pathTokens = result.path.reduce((sum, n) => sum + estimateTokens(n.summary || n.content.slice(0, 300)), 0);
      return wrapWithContextWarning(resultStr, pathTokens);
    },
  });
  return wrapWithTracking(t, store, "memory_drilldown");
}

export function MemorySearch(store: MemoryStore, defaultRerankMode?: "keyword" | "cross-encoder") {
  const t = tool({
    description: "Search memory for relevant context. Results may be re-ordered by relevance to your current reasoning via auto-retrieve reranking.",
    args: {
      query: tool.schema.string().describe("Search query text"),
      limit: tool.schema.number().int().positive().optional().describe("Maximum results to return (default 10)"),
      min_level: tool.schema.number().int().nonnegative().optional().describe("Minimum compression level (0=raw, 5=highest)"),
      max_level: tool.schema.number().int().nonnegative().optional().describe("Maximum compression level"),
      min_usefulness: tool.schema.number().min(0).max(5).optional().describe("Minimum usefulness score filter"),
      temporal_hops: tool.schema.number().int().min(0).max(5).optional().describe("Multi-hop temporal expansion depth (0=off, 1-5 for depth)"),
      rerank: tool.schema.boolean().optional().describe("Re-rank results by keyword overlap and position (default true)"),
      rerank_mode: tool.schema.enum(["keyword", "cross-encoder"]).optional().describe("Rerank strategy: keyword (default) or cross-encoder (local ONNX model, better relevance)"),
      subtask: tool.schema.enum(["analysis", "localization", "editing", "validation"]).optional().describe("Coding phase of this query — boosts memories captured during the same phase"),
      expand_links: tool.schema.boolean().optional().describe("Expand results with wiki-linked nodes (default true)"),
      expand_temporal: tool.schema.boolean().optional().describe("Expand results with temporally adjacent nodes (conversation flow)"),
      category_filter: tool.schema.enum(["episodic", "semantic"]).optional().describe("Filter to specific memory category (episodic=fast decay, semantic=long-term)"),
      domain_filter: tool.schema.enum(["architecture", "operations", "knowledge", "rules", "history", "patterns", "preferences"]).optional().describe("Filter to specific memory domain"),
      type: tool.schema.enum(["storedcontext", "workflow"]).optional().describe("Filter by memory node type (e.g. storedcontext, workflow)"),
      project_name: tool.schema.string().optional().describe("Project to search (defaults to the current project)"),
    },
    async execute(args) {
      const options: {
        minLevel?: MemoryNodeLevel;
        maxLevel?: MemoryNodeLevel;
        minUsefulness?: number;
        rerank?: boolean;
        rerankMode?: "keyword" | "cross-encoder";
        subtask?: MemorySubtask;
        projectName?: string;
        categoryFilter?: "episodic" | "semantic";
        domainFilter?: MemoryDomain;
        typeFilter?: MemoryNodeType;
        temporalHops?: number;
      } = {
        rerank: args.rerank ?? true,
      };
      if (args.rerank_mode !== undefined) options.rerankMode = args.rerank_mode;
      else if (defaultRerankMode !== undefined) options.rerankMode = defaultRerankMode;
      if (args.subtask !== undefined) options.subtask = args.subtask as MemorySubtask;
      if (args.min_level !== undefined) options.minLevel = args.min_level as MemoryNodeLevel;
      if (args.max_level !== undefined) options.maxLevel = args.max_level as MemoryNodeLevel;
      if (args.min_usefulness !== undefined) options.minUsefulness = args.min_usefulness;
      if (args.project_name !== undefined) options.projectName = args.project_name;
      options.projectName = options.projectName ?? store.projectName;
      if (args.category_filter !== undefined) options.categoryFilter = args.category_filter;
      if (args.domain_filter !== undefined) options.domainFilter = args.domain_filter;
      if (args.type !== undefined) options.typeFilter = args.type as MemoryNodeType;
      if (args.temporal_hops !== undefined && args.temporal_hops > 0) options.temporalHops = args.temporal_hops;

      let nodes = await searchNodes(store, generateEmbedding, args.query, {
        ...options,
        limit: args.limit ?? 10,
      });

      // Boost usefulness of retrieved nodes
      for (const node of nodes) {
        const newScore = Math.min(5, (node.usefulnessScore ?? 0) + 0.03);
        store.updateNode(node.id, { usefulnessScore: newScore }).catch(() => {/* node may be deleted concurrently */});
      }

      lastSearchResults.length = 0;
      lastSearchResults.push(...nodes.map(n => ({ id: n.id, label: n.label ?? undefined, scope: n.scope })));

      if (args.expand_links !== false && nodes.length > 0) {
        const expandLimit = (args.limit ?? 10) + 5;
        const seenIds = new Set(nodes.map(n => n.id));
        const linkedNodes: Array<{ node: typeof nodes[0]; linkedFrom: string }> = [];
        
        for (const node of nodes) {
          const links = await store.getLinkedNodes(node.scope, node.id);
          for (const linked of links) {
            if (!seenIds.has(linked.id)) {
              seenIds.add(linked.id);
              linkedNodes.push({ node: linked, linkedFrom: node.label ?? node.id.slice(0, 8) });
            }
          }
        }
        
        for (const { node, linkedFrom } of linkedNodes) {
          const boostedNode = {
            ...node,
            importance: (node.importance ?? 0.5) * 0.8,
            linkedFrom,
          };
          nodes.push(boostedNode);
        }
        
        nodes.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
        nodes = nodes.slice(0, expandLimit);
      }

      if (args.expand_temporal === true && nodes.length > 0) {
        const expandLimit = (args.limit ?? 10) + 5;
        const seenIds = new Set(nodes.map(n => n.id));
        const sourceIds = nodes.slice(0, 5).map(n => n.id);
        const temporalIds = await store.expandWithTemporalContext(sourceIds, 1);

        const tempNodes: Array<typeof nodes[0]> = [];
        for (const tid of temporalIds) {
          if (seenIds.has(tid)) continue;
          seenIds.add(tid);
          try {
            const node = await store.getNode(tid);
            tempNodes.push({ ...node, importance: (node.importance ?? 0.5) * 0.7 });
          } catch { /* node deleted */ }
        }

        nodes.push(...tempNodes);
        nodes.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
        nodes = nodes.slice(0, expandLimit);
      }

      if (nodes.length === 0) {
        return "No matching memory found. Try different keywords.";
      }

      const lines: string[] = [
        `## Memory Search Results (${nodes.length} matches)`,
        "",
        ...nodes.map(n => {
          const parentInfo = n.parentIds && n.parentIds.length > 0 
            ? ` (← ${n.parentIds.length} sources)` 
            : "";
          const linkInfo = (n as unknown as { linkedFrom?: string }).linkedFrom
            ? ` [linked from ${(n as unknown as { linkedFrom: string }).linkedFrom}]`
            : "";
          const matchPct = (n.importance! * 100).toFixed(0);
          const label = n.label ?? n.id.slice(0, 8);
          const catTag = n.category ? ` [${n.category}]` : "";
          const domainTag = n.domain ? ` [${n.domain}]` : "";
          const content = n.summary || n.content.slice(0, 300);
          return `### [L${n.level}]${catTag}${domainTag} ${label} - ${matchPct}% match${parentInfo}${linkInfo}\n${content}${content.length >= 300 ? "..." : ""}`;
        }),
        "",
        "Use memory(mode=\"drilldown\", label=\"...\") to see full content of any node.",
        "Use memory(mode=\"temporal_edges\", node_id=\"...\") to explore conversation flow.",
        "",
        "**Self-Reflection**: After using these memories, rate their usefulness (0-5):",
        "  `memory(mode=\"rate\", label: \"<node-label>\", helpful: true, usefulness_score: <rating>)`",
      ];

      const result = lines.join("\n");
      const contentTokens = nodes.reduce((sum, n) => sum + estimateTokens(n.summary || n.content.slice(0, 300)), 0);
      return wrapWithContextWarning(result, contentTokens);
    },
  });
  return wrapWithTracking(t, store, "memory_search");
}

export function MemoryDrilldownQuery(store: MemoryStore) {
  const t = tool({
    description: "Top-down drilldown query.",
    args: {
      query: tool.schema.string().describe("Search query for top-down drilldown"),
      max_results: tool.schema.number().int().positive().optional().describe("Maximum results to return (default 20)"),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const results = await store.drilldownQuery(args.query, args.max_results ?? 20, args.project_name);

      if (results.length === 0) {
        return `No memory found matching your query "${args.query}".

**Tip**: Use \`memory(mode="search", ...)\` first with broader keywords.`;
      }

      const summaryResults = results.filter(r => r.level === "summary");
      const intermediateResults = results.filter(r => r.level === "intermediate");
      const detailResults = results.filter(r => r.level === "detail");

      const lines: string[] = [
        `## Top-Down Drilldown: "${args.query}"`,
        "",
        `Found ${results.length} relevant memory nodes (${summaryResults.length} summaries, ${intermediateResults.length} intermediate, ${detailResults.length} details).`,
        "",
      ];

      if (summaryResults.length > 0) {
        lines.push("### High-Level Summaries");
        for (const result of summaryResults) {
          lines.push(`**[L${result.node.level}] ${result.node.label ?? result.node.id.slice(0, 8)}** (${(result.relevance * 100).toFixed(0)}% relevant)`);
          lines.push(`> ${result.node.content.slice(0, 200)}${result.node.content.length > 200 ? "..." : ""}`);
          if (result.path.length > 1) {
            lines.push(`_Source path: ${result.path.map(n => n.label ?? n.id.slice(0, 8)).join(" → ")}_`);
          }
          lines.push("");
        }
      }

      if (intermediateResults.length > 0) {
        lines.push("### Weekly Summaries");
        for (const result of intermediateResults) {
          lines.push(`**[L${result.node.level}] ${result.node.label ?? result.node.id.slice(0, 8)}** (${(result.relevance * 100).toFixed(0)}% relevant)`);
          lines.push(`> ${result.node.content.slice(0, 150)}${result.node.content.length > 150 ? "..." : ""}`);
          lines.push("");
        }
      }

      if (detailResults.length > 0) {
        lines.push("### Specific Details");
        for (const result of detailResults) {
          lines.push(`**[L${result.node.level}] ${result.node.label ?? result.node.id.slice(0, 8)}** (${(result.relevance * 100).toFixed(0)}% relevant)`);
          lines.push(`> ${result.node.content.slice(0, 150)}${result.node.content.length > 150 ? "..." : ""}`);
          lines.push("");
        }
      }

      lines.push("---");
      lines.push("_Use `memory(mode=\"drilldown\", id=\"...\")` for full path to any specific node._");

      const result = lines.join("\n");
      const contentTokens = results.reduce((sum, r) => sum + estimateTokens(r.node.content), 0);
      return wrapWithContextWarning(result, contentTokens);
    },
  });
  return wrapWithTracking(t, store, "memory_drilldown_query");
}