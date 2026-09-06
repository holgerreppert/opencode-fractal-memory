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

export function createMemoryTool(store: MemoryStore, defaultRerankMode?: "keyword" | "cross-encoder") {
  const handlers: Record<string, ToolDefinition> = {
    search: MemorySearch(store, defaultRerankMode),
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
    description: `PERSISTENT MEMORY — search existing knowledge first (100× cheaper than reading codebase cold). Unified tool with 9 modes + 4 verb aliases (memory_search, memory_fetch, memory_get, memory_set).

WHEN vs WHAT — decision per your task:
  Have a question or need context BEFORE reading/editing? → search (ALWAYS FIRST). Use concise keywords, NOT the raw user message. Example: query="auth JWT verification" not "what did we do about JWT?".
  Have a UUID from search/list? → get (id="6fb185e2-..."). Have an exact label like "fact:opencode-fractal-memory-hub" or "rule:mandatory:memory"? → fetch (label="..."). get accepts id OR label; fetch/drilldown use label; replace needs newText+oldText after get.
  Want to save what you just learned? → set (label + content + type) AFTER significant tool result — WHY it helps (prevents re-discovery). Verify with learn(mode=verify) after.
  Want to see what's stored? → list (survey by scope/level/importance).
  Need full graph with sources? → drilldown (after search) or drilldown_query (keyword top-down).

MODES — what + how + when + example:
  search — Find memories by keyword. Use BEFORE any edit/bash/write. Params: query (required, concise), limit (default 5), tagsFilter (intersection), rerank, rerank_mode "keyword"|"cross-encoder", intent. Ex: memory(mode="search", query="auth flow", limit=5) or memory_search(query="auth flow"). Also via alias: memory_search(query="auth flow"). Workflow: search → if >50% match then drilldown/get → set/verify.
  get — Get one node by UUID id (preferred) OR exact label. Scope defaults to project. Ex: memory(mode="get", id="6fb185e2-...") or memory_get(id="..."). Alias: memory_get.
  fetch — Quick lookup by exact label (sticky, dot:, rule:, fact:). Scope defaults to project. Ex: memory(mode="fetch", label="fact:svelte-stack") or memory_fetch(label="fact:svelte-stack").
  drilldown — Full context with fractal source chain for a node found via search. Param: label (exact) or id. Use AFTER search when relevance >50%. Ex: memory(mode="drilldown", label="fact:opencode-fractal-memory-hub").
  drilldown_query — Top-down drilldown by keyword (no id needed). Ex: memory(mode="drilldown_query", query="ranking").
  set — Store new node. Required: label, content, type (semantic: fact/lesson/concept/decision/knowledge/how_to...; episodic: event/note/session...). **Mandatory: summary (1-2 lines) + keywords (5-10 comma tokens, BM25 ×2 for hub network) — auto-generated if omitted.** Optional: level, importance, sticky, usefulness_score, tags via metadata. Ex: memory(mode="set", label="fact:auth-decision", content="We chose JWT via ...", type="fact", summary="JWT via jose, RS256", keywords="auth,jwt,jose,RS256") or memory_set(label="...", content="...", type="fact", summary="...", keywords="...").
  replace — Fix outdated node. Must re-read with get/fetch first to get current text. Params: id OR label + oldText + newText. Ex: memory(mode="replace", label="fact:x", oldText="old", newText="new").
  delete — Remove node by id or label. Verify via memory(mode="delete", label="..."); check existence before delete.
  list — Survey nodes: scope global|project|all, level, type_filter, limit. Ex: memory(mode="list", scope="project", limit=10).

ALIASES — distinct tools for discoverability (same handlers, clearer intent):
  memory_search(query, limit, tagsFilter) — alias for mode="search"
  memory_fetch(label) — alias for mode="fetch"
  memory_get(id|label) — alias for mode="get"
  memory_set(label, content, type, ...) — alias for mode="set"

WORKFLOW (always):
  search → drilldown/get → set/verify/replace
  NEVER drilldown with vague query — search first with concise keywords.
  BEFORE memory(mode="replace") re-read with get/fetch to ensure current content.
  AFTER set, run learn(mode=verify, label="...") to certify (diminishing returns 0.2/(1+verificationCount)).

TIPS:
  - memory(mode="search") BEFORE any edit/bash/write saves retracing past work (100×).
  - For context pressure >60%: context(mode="check") → compress; for facts/conventions keep semantic type (365d) not episodic (7d).
  - See also: graph(relation="search", query="Symbol") for code, context tool for compression, learn tool for verification.`,
    args: {
      mode: tool.schema.enum(["search", "get", "set", "delete", "list", "drilldown", "drilldown_query", "fetch", "replace"]).describe("Which memory operation to perform"),

      scope: tool.schema.enum(["global", "project", "all"]).optional(),
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      query: tool.schema.string().optional(),
      content: tool.schema.string().optional(),
      summary: tool.schema.string().optional().describe("Short 1-2 line summary (150-220 chars) — BM25-indexed; auto-generated if omitted"),
      keywords: tool.schema.string().optional().describe("Comma-separated keywords 5-10 tokens — BM25 ×2 weight for hub network lexical search; auto-generated if omitted"),
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
      temporal_hops: tool.schema.number().int().min(0).max(5).optional(),
      rerank: tool.schema.boolean().optional(),
      rerank_mode: tool.schema.enum(["keyword", "cross-encoder"]).optional().describe("Rerank strategy: keyword (default) or cross-encoder (local ONNX model, better relevance)"),
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
