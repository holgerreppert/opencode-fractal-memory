import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createApplication } from "../infrastructure/composition-root";
import type { MemoryStore } from "../storage/sqlite";
import type { MemoryNodeType } from "../storage/sqlite";
import { withMcpLogging, mcpLog } from "./logging";
import { nodeToPlain, ensureScope, resourceStats } from "./transform";
import { VERSION } from "../version";
import { executeGraphTool } from "../tools/graph";

let store: MemoryStore;

async function handleSearch(args: Record<string, unknown>) {
  const q = (args.query as string)?.trim();
  if (!q) return { content: [{ type: "text" as const, text: "[]" }] };

  const scope = (args.scope as "global" | "project") ?? "project";
  const limit = (args.limit as number) ?? 50;
  const projectName = args.project_name as string | undefined;
  try {
    const mode = (args.search_mode as "hybrid" | "bm25" | "text") ?? "hybrid";
    const { generateEmbedding } = await import("../infrastructure/llm/embeddings");
    const { searchNodes } = await import("../application/search");
    const opts: { limit: number; mode: "hybrid" | "bm25" | "text"; scope: "global" | "project"; projectName?: string | undefined } = {
      limit,
      mode,
      scope,
    };
    if (projectName !== undefined) opts.projectName = projectName;
    const nodes = await searchNodes(store, generateEmbedding, q, opts);
    return { content: [{ type: "text" as const, text: JSON.stringify(nodes.map(n => nodeToPlain(n)), null, 2) }] };
  } catch (e) {
    return {
      content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
}

export async function createMemoryMcpServer(projectDir: string, globalDbPath: string): Promise<McpServer> {
  mcpLog("info", "Creating memory store", { projectDir });
  const ctx = await createApplication(projectDir, globalDbPath);
  store = ctx.store;
  mcpLog("info", "Memory store created");

  const server = new McpServer(
    { name: "opencode-fractal-memory", version: VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.registerTool(
    "memory",
    {
      description: `Multi-mode memory tool for storing and retrieving knowledge.

MODES:
  search    — Find relevant memories by keyword (text, embedding, or bm25)
  get       — Get a specific node by ID
  fetch     — Get a node by exact label
  list      — Survey available nodes with optional filters
  stats     — Get memory statistics
  set       — Create or update a memory node
  delete    — Delete a memory node by ID

WORKFLOW: search → get/fetch → set/delete`,
      inputSchema: {
        mode: z.enum(["search", "get", "fetch", "list", "stats", "set", "delete"]).describe("Which memory operation to perform"),

        // shared params
        scope: z.enum(["global", "project"]).optional().default("project"),
        project_name: z.string().optional(),

        // search params
        query: z.string().optional().describe("Search query (required for search mode)"),
        search_mode: z.enum(["hybrid", "bm25", "text"]).optional().default("hybrid").describe("Search mode (search only): hybrid = semantic+BM25 RRF fusion (default), bm25 = keyword FTS5, text = LIKE match"),

        // get/fetch params
        id: z.string().optional().describe("Node ID (required for get, delete)"),
        label: z.string().optional().describe("Node label (required for fetch, set)"),

        // list params
        level: z.number().int().min(0).max(4).optional().describe("Filter by compression level (list only)"),
        type: z.string().optional().describe("Filter by node type (list only)"),
        limit: z.number().int().positive().optional().default(100).describe("Max results (list, search only)"),
        offset: z.number().int().nonnegative().optional().default(0).describe("Pagination offset (list only)"),

        // set params
        content: z.string().optional().describe("Node content (required for set)"),
        importance: z.number().min(0).max(1).optional().default(0.5).describe("Importance (set only)"),
        metadata: z.string().optional().describe("JSON string of metadata (set only)"),
      },
    },
    withMcpLogging("memory", async (args) => {
      const mode = args.mode;
      try {
        switch (mode) {
          case "search":
            return await handleSearch(args as Record<string, unknown>);
          case "get": {
            const node = await store.getNode(args.id!);
            return { content: [{ type: "text" as const, text: JSON.stringify(nodeToPlain(node), null, 2) }] };
          }
          case "fetch": {
            const node = await store.getNodeByLabel(ensureScope(args.scope), args.label!);
            return { content: [{ type: "text" as const, text: JSON.stringify(nodeToPlain(node), null, 2) }] };
          }
          case "list": {
            let nodes = await store.listNodes(args.scope, args.level as 0 | 1 | 2 | 3 | 4 | undefined, undefined, undefined, undefined, args.project_name);
            if (args.type) nodes = nodes.filter(n => n.type === args.type);
            const total = nodes.length;
            if (args.offset! > 0) nodes = nodes.slice(args.offset);
            if (args.limit) nodes = nodes.slice(0, args.limit);
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ total, nodes: nodes.map(n => nodeToPlain(n)) }, null, 2) }],
            };
          }
          case "stats": {
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
          }
          case "set": {
            const scope = ensureScope(args.scope);
            let metadata: Record<string, unknown> | null = null;
            if (args.metadata) {
              try {
                metadata = JSON.parse(args.metadata);
              } catch {
                return {
                  content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "metadata must be valid JSON" }) }],
                  isError: true,
                };
              }
            }
            const existing = await store.getNodeByLabel(scope, args.label!).catch(() => null);
            if (existing) {
              await store.updateNode(existing.id, {
                content: args.content ?? existing.content,
                level: (args.level as 0 | 1 | 2 | 3 | 4 | 5) ?? existing.level,
                type: (args.type as MemoryNodeType | null) ?? existing.type,
                importance: args.importance ?? existing.importance,
                metadata: metadata ?? existing.metadata,
              });
              return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, id: existing.id, action: "updated" }) }] };
            }
            const created = await store.createNode({
              scope,
              label: args.label!,
              content: args.content ?? "",
              level: (args.level as 0 | 1 | 2 | 3 | 4 | 5) ?? 0,
              type: (args.type as import("../storage/types").MemoryNodeType | null) ?? null,
              importance: args.importance ?? 0.5,
              metadata,
              projectName: args.project_name ?? store.projectName,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, id: created.id, action: "created" }) }] };
          }
          case "delete": {
            const node = await store.getNode(args.id!).catch(() => null);
            if (!node) {
              return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Node not found" }) }], isError: true };
            }
            await store.deleteNode(args.id!);
            return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, id: args.id, action: "deleted" }) }] };
          }
          default:
            return { content: [{ type: "text" as const, text: `Unknown mode: ${mode}` }], isError: true };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not found")) {
          return { content: [{ type: "text" as const, text: "Node not found" }], isError: true };
        }
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    })
  );

  // ==================== Graph Tool ====================

  server.registerTool(
    "graph",
    {
      description: `Navigate the code graph (AST symbols + call/import edges).
Use BEFORE editing a function to check callers. Use AFTER finding a symbol to trace its dependencies.

Relations:
  callers     — who calls this symbol name?
  callees     — what does this symbol call?
  call_chain  — transitive callers up to N depth (BFS)
  imports     — what modules/paths does this file import?
  dependents  — what files import this module/path?
  search      — find graph nodes by name or file path
  explain     — get all neighbors of a graph node by ID
  path        — shortest path between two nodes by ID`,
      inputSchema: {
        relation: z.enum(["callers", "callees", "call_chain", "imports", "dependents", "search", "explain", "path"]).describe("The type of graph query to perform"),
        name: z.string().optional().describe("Symbol name (required for callers, callees, call_chain)"),
        file: z.string().optional().describe("File path (required for imports, dependents)"),
        depth: z.number().int().min(1).max(10).optional().describe("Max depth for call_chain (default 5)"),
        query: z.string().optional().describe("Search query (required for search)"),
        from: z.string().optional().describe("Source node ID (required for path)"),
        to: z.string().optional().describe("Target node ID (required for path)"),
        id: z.string().optional().describe("Node ID (required for explain)"),
        limit: z.number().int().positive().optional().describe("Max results (default 50 for search, 200 for others)"),
      },
    },
    withMcpLogging("graph", async (args) => {
      const result = executeGraphTool(args as import("../tools/graph").GraphToolParams);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
