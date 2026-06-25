import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import type { MemoryNodeType } from "../storage/types";

export function MemoryRecallContext(store: MemoryStore) {
  return tool({
    description: "Recall stored conversation context that was archived during compaction. Use this when you need to remember details from earlier in the conversation that may have been pruned. Supports semantic search by query, session ID filtering, and recency-based retrieval.",
    args: {
      query: tool.schema.string().optional().describe("Search query to find relevant storedcontext nodes by semantic similarity"),
      sessionId: tool.schema.string().optional().describe("Filter to a specific session by its ID"),
      limit: tool.schema.number().int().positive().optional().describe("Maximum number of storedcontext nodes to return (default: 5)"),
    },
    async execute(args) {
      const limit = args.limit ?? 5;
      let nodes = [];

      if (args.sessionId) {
        const allNodes = await store.listNodes("all");
        nodes = allNodes.filter(n => {
          if (n.type === "storedcontext" || n.type === null) {
            if (n.label?.includes(args.sessionId!)) return true;
            try {
              const meta = n.metadata as Record<string, unknown> | null;
              return meta?.sessionId === args.sessionId;
            } catch { return false; }
          }
          return false;
        });
        nodes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        nodes = nodes.slice(0, limit);
      } else if (args.query) {
        const queryEmbedding = await generateEmbedding(args.query);
        nodes = await store.searchByEmbedding(queryEmbedding, limit, {
          typeFilter: "storedcontext" as MemoryNodeType,
          queryText: args.query,
          bm25Weight: 0.3,
        });
      } else {
        const allNodes = await store.listNodes("all");
        nodes = allNodes
          .filter(n => n.type === "storedcontext")
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit);
      }

      if (nodes.length === 0) {
        if (args.sessionId) {
          return `No stored context found for session "${args.sessionId}".`;
        }
        return "No stored context found. Conversation context is only archived during compaction, which happens automatically when the agent deems it necessary.";
      }

      const lines: string[] = [
        `## Stored Context Recall (${nodes.length} results)`,
        "",
      ];

      for (const node of nodes) {
        const meta = node.metadata as Record<string, unknown> | null;
        const sessionLabel = meta?.sessionId ?? node.label?.replace("storedcontext:", "").split(":")[0] ?? "unknown";
        const timestamp = node.createdAt.toISOString();
        const contentPreview = node.content.slice(0, 2000);

        lines.push(`### Session: ${sessionLabel}`);
        lines.push(`**Archived**: ${timestamp} | **Label**: ${node.label ?? node.id.slice(0, 8)}`);
        lines.push("");

        const contentLines = contentPreview.split("\n");
        for (const line of contentLines) {
          lines.push(line);
        }

        if (node.content.length > 2000) {
          lines.push("");
          lines.push(`_... content truncated (${node.content.length} total chars). Use memory_fetch label:"${node.label}" for full content._`);
        }

        lines.push("");
        lines.push("---");
        lines.push("");
      }

      lines.push("**Tip**: Use `memory_search type:storedcontext query:\"<details>\"` for more targeted recall.");

      return lines.join("\n");
    },
  });
}