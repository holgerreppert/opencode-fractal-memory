import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createSqliteMemoryStore } from "../storage/sqlite";
import type { MemoryScope, MemoryNodeType } from "../storage/sqlite";
import { withMcpLogging, mcpLog } from "./logging";
import { nodeToPlain, ensureScope, resourceStats } from "./transform";
import { VERSION } from "../version";

let store: ReturnType<typeof createSqliteMemoryStore>;

export async function createMemoryMcpServer(projectDir: string, globalDbPath: string): Promise<McpServer> {
  mcpLog("info", "Creating memory store", { projectDir });
  store = createSqliteMemoryStore(projectDir, globalDbPath);
  mcpLog("info", "Memory store created");

  const server = new McpServer(
    { name: "opencode-fractal-memory", version: VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.registerTool(
    "memory_search",
    {
      description: "Search memory nodes by text, embedding similarity, or BM25 score",
      inputSchema: {
        query: z.string().describe("Search query"),
        scope: z.enum(["global", "project"]).optional().default("project").describe("Memory scope"),
        mode: z.enum(["text", "embedding", "bm25"]).optional().default("text").describe("Search mode"),
        limit: z.number().int().positive().optional().default(50).describe("Max results"),
        project_name: z.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
      },
    },
    withMcpLogging("memory_search", async (args) => {
      const q = args.query.trim();
      if (!q) return { content: [{ type: "text" as const, text: "[]" }] };

      const scope = args.scope;
      const limit = args.limit;
      try {
        if (args.mode === "text") {
          const nodes = await store.listNodes(scope, undefined, undefined, undefined, undefined, args.project_name);
          const lower = q.toLowerCase();
          const results = nodes
            .filter(n => (n.label?.toLowerCase().includes(lower)) || n.content.toLowerCase().includes(lower))
            .sort((a, b) => b.importance - a.importance)
            .slice(0, limit)
            .map(n => ({ ...nodeToPlain(n), score: n.importance }));
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        }

        if (args.mode === "embedding") {
          const { generateEmbedding } = await import("../infrastructure/llm/embeddings");
          const queryEmbedding = await generateEmbedding(q);
          const opts: { queryText: string; projectName?: string } = { queryText: q };
          if (args.project_name) opts.projectName = args.project_name;
          const nodes = await store.searchByEmbedding(queryEmbedding, limit, opts);
          return { content: [{ type: "text" as const, text: JSON.stringify(nodes.map(n => nodeToPlain(n)), null, 2) }] };
        }

        if (args.mode === "bm25") {
          const nodes = await store.listNodes(scope, undefined, undefined, undefined, undefined, args.project_name);
          const terms = q.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(t => t.length >= 2);
          if (terms.length === 0) return { content: [{ type: "text" as const, text: "[]" }] };

          const scored = nodes.map(n => {
            const text = `${n.label ?? ""} ${n.content}`.toLowerCase();
            let score = 0;
            for (const term of terms) {
              const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
              const matches = text.match(regex);
              score += matches ? matches.length : 0;
            }
            return { ...nodeToPlain(n), score };
          });
          scored.sort((a, b) => (b.score as number) - (a.score as number));
          return { content: [{ type: "text" as const, text: JSON.stringify(scored.slice(0, limit), null, 2) }] };
        }

        return { content: [{ type: "text" as const, text: "[]" }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    })
  );

  server.registerTool(
    "memory_get",
    {
      description: "Get a single memory node by ID",
      inputSchema: {
        id: z.string().describe("Node ID"),
        scope: z.enum(["global", "project"]).optional().default("project").describe("Memory scope"),
      },
    },
    withMcpLogging("memory_get", async (args) => {
      try {
        const node = await store.getNode(args.id);
        return { content: [{ type: "text" as const, text: JSON.stringify(nodeToPlain(node), null, 2) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not found")) {
          return { content: [{ type: "text" as const, text: "Node not found" }], isError: true };
        }
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    })
  );

  server.registerTool(
    "memory_fetch",
    {
      description: "Fetch a memory node by exact label",
      inputSchema: {
        label: z.string().describe("Node label"),
        scope: z.enum(["global", "project"]).optional().default("project").describe("Memory scope"),
      },
    },
    withMcpLogging("memory_fetch", async (args) => {
      try {
        const node = await store.getNodeByLabel(ensureScope(args.scope), args.label);
        return { content: [{ type: "text" as const, text: JSON.stringify(nodeToPlain(node), null, 2) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not found")) {
          return { content: [{ type: "text" as const, text: "Node not found" }], isError: true };
        }
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    })
  );

  server.registerTool(
    "memory_list",
    {
      description: "List memory nodes with optional filters",
      inputSchema: {
        scope: z.enum(["global", "project"]).optional().default("project").describe("Memory scope"),
        level: z.number().int().min(0).max(4).optional().describe("Filter by compression level"),
        type: z.string().optional().describe("Filter by node type (note, event, concept, summary, etc.)"),
        limit: z.number().int().positive().optional().default(100).describe("Max results"),
        offset: z.number().int().nonnegative().optional().default(0).describe("Pagination offset"),
        project_name: z.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
      },
    },
    withMcpLogging("memory_list", async (args) => {
      try {
        let nodes = await store.listNodes(args.scope, args.level as 0 | 1 | 2 | 3 | 4 | undefined, undefined, undefined, undefined, args.project_name);

        if (args.type) {
          nodes = nodes.filter(n => n.type === args.type);
        }

        const total = nodes.length;
        if (args.offset > 0) nodes = nodes.slice(args.offset);
        if (args.limit) nodes = nodes.slice(0, args.limit);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ total, nodes: nodes.map(n => nodeToPlain(n)) }, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    })
  );

  server.registerTool(
    "memory_stats",
    {
      description: "Get memory statistics for a scope",
      inputSchema: {
        scope: z.enum(["global", "project"]).optional().default("project").describe("Memory scope"),
        project_name: z.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
      },
    },
    withMcpLogging("memory_stats", async (args) => {
      try {
        const [stats, nodes] = await Promise.all([
          store.getFractalStats(args.scope, args.project_name),
          store.listNodes(args.scope, undefined, undefined, undefined, undefined, args.project_name),
        ]);

        const total = stats.totalNodes;
        const avgImportance = total > 0 ? nodes.reduce((s, n) => s + n.importance, 0) / total : 0;
        const avgUsefulness = total > 0 ? nodes.reduce((s, n) => s + (n.usefulnessScore ?? 0), 0) / total : 0;
        const stickyCount = nodes.filter(n => n.sticky).length;
        const types: Record<string, number> = {};
        for (const n of nodes) {
          const t = n.type ?? "unknown";
          types[t] = (types[t] ?? 0) + 1;
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              scope: args.scope,
              totalNodes: total,
              nodesPerLevel: stats.nodesPerLevel,
              nodesPerType: types,
              avgImportance: Math.round(avgImportance * 100) / 100,
              avgUsefulness: Math.round(avgUsefulness * 100) / 100,
              totalAccessCount: nodes.reduce((s, n) => s + n.accessCount, 0),
              stickyCount,
            }, null, 2),
          }],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    })
  );

  server.registerTool(
    "memory_set",
    {
      description: "Create or update a memory node",
      inputSchema: {
        label: z.string().describe("Node label (if updating an existing node, provide existing label)"),
        content: z.string().describe("Node content"),
        scope: z.enum(["global", "project"]).optional().default("project").describe("Memory scope"),
        level: z.number().int().min(0).max(4).optional().default(0).describe("Compression level"),
        type: z.string().optional().describe("Node type (note, event, concept, summary, etc.)"),
        importance: z.number().min(0).max(1).optional().default(0.5).describe("Importance score"),
        metadata: z.string().optional().describe("JSON string of metadata object (e.g. triggers for skills)"),
        project_name: z.string().optional().describe("Assign to a specific project (defaults to current project)"),
      },
    },
    withMcpLogging("memory_set", async (args) => {
      const scope = ensureScope(args.scope);
      let metadata: Record<string, unknown> | null = null;
      if (args.metadata) {
        try {
          metadata = JSON.parse(args.metadata as string);
        } catch {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "metadata must be valid JSON" }) }],
            isError: true,
          };
        }
      }

      try {
        const existing = await store.getNodeByLabel(scope, args.label).catch(() => null);

        if (existing) {
          await store.updateNode(existing.id, {
            content: args.content,
            level: args.level as 0 | 1 | 2 | 3 | 4 | 5,
            type: (args.type as MemoryNodeType | null) ?? null,
            importance: args.importance,
            metadata: metadata ?? undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, id: existing.id, action: "updated" }) }] };
        }

        const node = await store.createNode({
          scope,
          label: args.label,
          content: args.content,
          level: args.level as 0 | 1 | 2 | 3 | 4 | 5,
          type: (args.type as import("../storage/types").MemoryNodeType | null) ?? null,
          importance: args.importance,
          metadata,
          projectName: args.project_name ?? store.projectName,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, id: node.id, action: "created" }) }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    })
  );

  server.registerTool(
    "memory_delete",
    {
      description: "Delete a memory node by ID",
      inputSchema: {
        id: z.string().describe("Node ID to delete"),
        scope: z.enum(["global", "project"]).optional().default("project").describe("Memory scope"),
      },
    },
    withMcpLogging("memory_delete", async (args) => {
      try {
        const node = await store.getNode(args.id).catch(() => null);
        if (!node) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Node not found" }) }], isError: true };
        }
        await store.deleteNode(args.id);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, id: args.id, action: "deleted" }) }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    })
  );

  server.registerResource(
    "Memory Stats (project)",
    "memory://stats/project",
    { description: "Memory statistics for project scope" },
    async (uri) => {
      mcpLog("info", "resource:read", { uri: uri.href });
      return { contents: [{ uri: uri.href, text: await resourceStats("project", store), mimeType: "application/json" }] };
    }
  );

  server.registerResource(
    "Memory Stats (global)",
    "memory://stats/global",
    { description: "Memory statistics for global scope" },
    async (uri) => {
      mcpLog("info", "resource:read", { uri: uri.href });
      return { contents: [{ uri: uri.href, text: await resourceStats("global", store), mimeType: "application/json" }] };
    }
  );

  return server;
}
