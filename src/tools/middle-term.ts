import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";

/**
 * Retrieve middle-term context snapshots (pre-compaction captures).
 * These are created automatically before OpenCode's compaction process.
 */
export function MemoryMiddleTerm(store: MemoryStore) {
  return tool({
    description: "Retrieve middle-term context snapshots (pre-compaction captures). These are created automatically before OpenCode's compaction process to preserve working state.",
    args: {
      sessionId: tool.schema.string().optional().describe("Filter by session ID"),
      limit: tool.schema.number().optional().describe("Maximum number of results to return (default: 10)"),
    },
    async execute(args) {
      // Get all nodes and filter by metadata.customType="middle-term" or type="note" with appropriate metadata
      const allNodes = await store.listNodes("all");
      let nodes = allNodes.filter(n => {
        // Check if metadata contains customType: "middle-term" or if label starts with "middle-term:"
        if (n.metadata && typeof n.metadata === 'object' && 'customType' in n.metadata) {
          return n.metadata.customType === "middle-term";
        }
        return n.label?.startsWith("middle-term:") ?? false;
      });

      // Filter by sessionId if provided
      if (args.sessionId) {
        const sessionId = args.sessionId; // Create a const to help TypeScript
        nodes = nodes.filter(n => {
          try {
            const data = JSON.parse(n.content);
            return data.sessionId === sessionId;
          } catch {
            return n.label?.includes(sessionId) ?? false;
          }
        });
      }

      // Limit results
      nodes = nodes.slice(0, args.limit || 10);

      if (nodes.length === 0) {
        return "No middle-term context found.";
      }

      // Parse and return structured info
      const results = nodes.map(n => {
        try {
          const data = JSON.parse(n.content);
          return {
            label: n.label,
            timestamp: data.timestamp || "unknown",
            sessionId: data.sessionId || "unknown",
            workingCacheSize: data.workingCache?.length || 0,
            recentNodesCount: data.recentNodes?.length || 0,
            contextTokens: data.contextTokens || 0,
          };
        } catch {
          return {
            label: n.label,
            timestamp: "unknown",
            sessionId: "unknown",
            workingCacheSize: 0,
            recentNodesCount: 0,
            contextTokens: 0,
          };
        }
      });

      return JSON.stringify(results, null, 2);
    },
  });
}
