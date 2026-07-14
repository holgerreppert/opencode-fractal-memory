import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { MemoryStore } from "../../storage/sqlite";
import { MemoryGet, MemorySet, MemoryDelete, MemoryList, MemoryFetch, MemoryReplace } from "../core";
import { MemorySearch, MemoryDrilldown, MemoryDrilldownQuery } from "../search";

const SUGGESTIONS: Record<string, string> = {
  search: "\n\n---\nNEXT: `memory(mode=get, id=<node>)` for full context, or `memory(mode=drilldown, id=<node>)` for source chain.",
  get: "\n\n---\nNEXT: `memory(mode=set)` to store new info, or `learn(mode=verify, id=<node>)` to certify correctness.",
  set: "\n\n---\nNEXT: `learn(mode=verify, label=<label>)` to certify correctness.",
  delete: "\n\n---\nNEXT: `memory(mode=list)` to verify the node is removed.",
  list: "\n\n---\nNEXT: `memory(mode=get, id=<node>)` for full context of a listed node.",
  drilldown: "\n\n---\nNEXT: `memory(mode=set)` to store new info, or `memory(mode=search)` for more context.",
  drilldown_query: "\n\n---\nNEXT: `memory(mode=drilldown, id=<node>)` for source chain from a result.",
  fetch: "\n\n---\nNEXT: `memory(mode=get, id=<node>)` for full context, or `memory(mode=search)` for more.",
  replace: "\n\n---\nNEXT: `learn(mode=verify, label=<label>)` to certify the updated content.",
};

export function createMemoryTool(store: MemoryStore) {
  const handlers: Record<string, ToolDefinition> = {
    search: MemorySearch(store),
    get: MemoryGet(store),
    set: MemorySet(store),
    delete: MemoryDelete(store),
    list: MemoryList(store),
    drilldown: MemoryDrilldown(store),
    drilldown_query: MemoryDrilldownQuery(store),
    fetch: MemoryFetch(store),
    replace: MemoryReplace(store),
  };

  const t = tool({
    description: `Multi-mode memory tool for storing and retrieving knowledge.

MODES:
  search    — Find relevant memories by keyword (USE FIRST when looking for context)
  get       — Get a specific node by ID or label (use after search)
  set       — Store new information as a memory node
  delete    — Remove a memory node by ID or label
  list      — Survey available nodes (scope, level, importance)
  drilldown — Get full context with fractal source chain (use after search)
  drilldown_query — Top-down drilldown by keyword
  fetch     — Quick lookup by exact label
  replace   — Fix outdated content in a node

WORKFLOW:
  search → drilldown/get → set/verify/replace

TIP: Use memory_search FIRST before any other memory tool.
TIP: After storing, verify correctness with learn(mode=verify).
TIP: For context management, use context tool.`,
    args: {
      mode: tool.schema.enum(["search", "get", "set", "delete", "list", "drilldown", "drilldown_query", "fetch", "replace"]).describe("Which memory operation to perform"),

      scope: tool.schema.enum(["global", "project", "all"]).optional(),
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      query: tool.schema.string().optional(),
      content: tool.schema.string().optional(),
      summary: tool.schema.string().optional(),
      level: tool.schema.number().int().nonnegative().optional(),
      parent_ids: tool.schema.string().optional(),
      importance: tool.schema.number().optional(),
      type: tool.schema.string().optional(),
      ttl_days: tool.schema.number().int().min(0).optional(),
      no_embedding: tool.schema.boolean().optional(),
      sticky: tool.schema.boolean().optional(),
      usefulness_score: tool.schema.number().min(0).max(5).optional(),
      metadata: tool.schema.string().optional(),

      limit: tool.schema.number().int().positive().optional(),
      min_level: tool.schema.number().int().nonnegative().optional(),
      max_level: tool.schema.number().int().nonnegative().optional(),
      min_usefulness: tool.schema.number().min(0).max(5).optional(),
      bm25_weight: tool.schema.number().min(0).max(1).optional(),
      temporal_hops: tool.schema.number().int().min(0).max(5).optional(),
      rerank: tool.schema.boolean().optional(),
      expand_links: tool.schema.boolean().optional(),
      expand_temporal: tool.schema.boolean().optional(),
      category_filter: tool.schema.enum(["episodic", "semantic"]).optional(),
      type_filter: tool.schema.enum(["storedcontext"]).optional(),
      project_name: tool.schema.string().optional(),

      max_depth: tool.schema.number().int().nonnegative().optional(),
      max_results: tool.schema.number().int().positive().optional(),
      oldText: tool.schema.string().optional(),
      newText: tool.schema.string().optional(),
    },
    async execute(args, ctx) {
      const mode = args.mode as string;
      const handler = handlers[mode as keyof typeof handlers];
      if (!handler) {
        return `Unknown mode: ${mode}. Available modes: ${Object.keys(handlers).join(", ")}`;
      }
      const result = await handler.execute(args, ctx);
      const suggestion = SUGGESTIONS[mode];
      if (suggestion && typeof result === "string") {
        return result + suggestion;
      }
      return result;
    },
  });

  return t;
}
