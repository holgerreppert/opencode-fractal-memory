import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { estimateTokens, generateEmbedding } from "../embeddings";
import { resolveNode, wrapWithContextWarning, wrapWithTracking, lastSearchResults } from "./shared";

export function MemoryDrilldown(store: MemoryStore) {
  const t = tool({
    description: "Retrieve a memory node with path to source nodes (fractal retrieval).",
    args: {
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      scope: tool.schema.enum(["global", "project"]).optional(),
      max_depth: tool.schema.number().int().nonnegative().optional(),
    },
    async execute(args) {
      const node = await resolveNode(store, args);
      const nodeId = node.id;

      const result = await store.retrieveFractal(nodeId, args.max_depth ?? 10);
      
      const lines: string[] = [
        `## Fractal Retrieval: ${result.node.label ?? result.node.id.slice(0, 8)}`,
        `Level: ${result.node.level} | Depth: ${result.depth} | Relevance: ${result.relevanceScore.toFixed(2)}`,
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
      const pathTokens = result.path.reduce((sum, n) => sum + estimateTokens(n.content), 0);
      return wrapWithContextWarning(resultStr, pathTokens);
    },
  });
  return wrapWithTracking(t, store, "memory_drilldown");
}

export function MemorySearch(store: MemoryStore) {
  const t = tool({
    description: "Search memory for relevant context.",
    args: {
      query: tool.schema.string(),
      limit: tool.schema.number().int().positive().optional(),
      min_level: tool.schema.number().int().nonnegative().optional(),
      max_level: tool.schema.number().int().nonnegative().optional(),
      min_usefulness: tool.schema.number().min(0).max(5).optional(),
      bm25_weight: tool.schema.number().min(0).max(1).optional(),
      rerank: tool.schema.boolean().optional(),
      expand_links: tool.schema.boolean().optional(),
    },
    async execute(args) {
      const queryEmbedding = await generateEmbedding(args.query);
      
      const options: { minLevel?: 0 | 1 | 2 | 3 | 4 | 5; maxLevel?: 0 | 1 | 2 | 3 | 4 | 5; bm25Weight?: number; queryText?: string; minUsefulness?: number; rerank?: boolean } = {
        bm25Weight: args.bm25_weight ?? 0.4,
        queryText: args.query,
        rerank: args.rerank ?? true,
      };
      if (args.min_level !== undefined) options.minLevel = args.min_level as 0 | 1 | 2 | 3 | 4 | 5;
      if (args.max_level !== undefined) options.maxLevel = args.max_level as 0 | 1 | 2 | 3 | 4 | 5;
      if (args.min_usefulness !== undefined) options.minUsefulness = args.min_usefulness;
      
      let nodes = await store.searchByEmbedding(queryEmbedding, args.limit ?? 10, options);

      lastSearchResults.length = 0;
      lastSearchResults.push(...nodes.map(n => ({ id: n.id, label: n.label, scope: n.scope })));

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
          const content = n.summary || n.content.slice(0, 300);
          return `### [L${n.level}] ${label} - ${matchPct}% match${parentInfo}${linkInfo}\n${content}${content.length >= 300 ? "..." : ""}`;
        }),
        "",
        "Use memory_drilldown(label) to see full content of any node.",
        "",
        "**Self-Reflection**: After using these memories, rate their usefulness (0-5):",
        "  `memory_rate { label: \"<node-label>\", helpful: true, usefulness_score: <rating> }`",
      ];

      const result = lines.join("\n");
      const contentTokens = nodes.reduce((sum, n) => sum + estimateTokens(n.content), 0);
      return wrapWithContextWarning(result, contentTokens);
    },
  });
  return wrapWithTracking(t, store, "memory_search");
}

export function MemoryDrilldownQuery(store: MemoryStore) {
  const t = tool({
    description: "Top-down drilldown query.",
    args: {
      query: tool.schema.string(),
      max_results: tool.schema.number().int().positive().optional(),
    },
    async execute(args) {
      const results = await store.drilldownQuery(args.query, args.max_results ?? 20);

      if (results.length === 0) {
        return `No memory found matching your query "${args.query}".

**Tip**: Use \`memory_search\` first with broader keywords.`;
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
      lines.push("_Use `memory_drilldown(id=\"...\")` for full path to any specific node._");

      const result = lines.join("\n");
      const contentTokens = results.reduce((sum, r) => sum + estimateTokens(r.node.content), 0);
      return wrapWithContextWarning(result, contentTokens);
    },
  });
  return wrapWithTracking(t, store, "memory_drilldown_query");
}