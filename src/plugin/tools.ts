import type { MemoryStore } from "../storage/sqlite";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { MemConfig } from "../infrastructure/config/config";
import { memLog } from "../logging";
import { createMemoryTool } from "../tools/consolidated/memory";
import { createContextTool } from "../tools/consolidated/context";
import { createLearnTool } from "../tools/consolidated/learn";
import { createJournalTool } from "../tools/consolidated/journal";
import { createGraphPluginTool } from "../tools/graph";
import { createSkeletonizeTool } from "../tools/consolidated/skeletonize";
import { createContextCompressTool } from "../tools/context-compress";
import { createSessionMessagesTool } from "../tools/session-messages";
import { createExpandTool } from "../tools/expand";
import { createProjectHubTool } from "../tools/project-hub";
import { ToastService } from "../infrastructure/toast-service";
import type { JournalStore, JournalContext } from "../application/journal";

export function createToolMap(
  store: MemoryStore,
  journalTools: Record<string, ToolDefinition>,
  client: unknown,
  journalStore: JournalStore | null,
  journalCtx: JournalContext,
  memConfig: MemConfig,
  toastService: ToastService,
) {
  const rerankMode = memConfig.ollama?.strategy === "cross-encoder" ? "cross-encoder" : memConfig.ollama?.strategy === "llm" ? "keyword" : undefined;
  const compressTool = createContextCompressTool(store, client, memConfig, toastService);
  memLog("info", "tool-map", "CREATED archivecontext tool", {
    toolID: "archivecontext",
    hasExecute: typeof (compressTool as { execute?: unknown }).execute === "function",
    argKeys: Object.keys(((compressTool as { args?: object }).args ?? {})),
    description: ((compressTool as { description?: string }).description ?? "").slice(0, 80),
  });
  const memoryTool = createMemoryTool(store, rerankMode) as unknown as ToolDefinition & { execute: (args: Record<string, unknown>, ctx: unknown) => Promise<string> };
  // Verb-named aliases for discoverability (same handlers, clearer intent — Anthropic namespacing)
  const memorySearchAlias = tool({
    description: `memory_search — alias for memory(mode="search"). USE WHEN you need prior context BEFORE reading/editing. ALWAYS FIRST — 100× cheaper than read. Use concise keywords (not raw user message). Workflow: search → if >50% match drilldown/get → set. Params: query (required), limit, tagsFilter intersection, rerank, rerank_mode. Ex: memory_search(query="auth JWT verification", limit=5)`,
    args: {
      query: tool.schema.string().describe("Concise keywords (NOT raw user message) — e.g. 'auth JWT verification'"),
      limit: tool.schema.number().int().positive().optional().describe("Max results (default 5)"),
      tagsFilter: tool.schema.array(tool.schema.string()).optional().describe("Intersection filter — only nodes containing ALL tags"),
      rerank: tool.schema.boolean().optional(),
      rerank_mode: tool.schema.enum(["keyword", "cross-encoder"]).optional().describe("cross-encoder = local ONNX better relevance"),
      scope: tool.schema.enum(["global", "project", "all"]).optional().describe("global= cross-project rules, project=current repo (default), all=both"),
      category_filter: tool.schema.enum(["episodic", "semantic"]).optional(),
      min_level: tool.schema.number().int().nonnegative().optional(),
      max_level: tool.schema.number().int().nonnegative().optional(),
    },
    async execute(args, ctx) {
      return (memoryTool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ...args, mode: "search" }, ctx);
    },
  });
  const memoryFetchAlias = tool({
    description: `memory_fetch — alias for memory(mode="fetch"). USE WHEN you know the exact label (fact:..., rule:..., dot:...). Quick lookup by exact label. Ex: memory_fetch(label="fact:svelte-stack") or with scope global.`,
    args: {
      label: tool.schema.string().describe("Exact label — e.g. 'fact:opencode-fractal-memory-hub', 'rule:mandatory:memory', 'dot:arch'"),
      scope: tool.schema.enum(["global", "project", "all"]).optional(),
    },
    async execute(args, ctx) {
      return (memoryTool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ...args, mode: "fetch" }, ctx);
    },
  });
  const memoryGetAlias = tool({
    description: `memory_get — alias for memory(mode="get"). USE WHEN you have UUID id from search/list OR exact label. Returns one node with content + metadata. Ex: memory_get(id="6fb185e2-...") or label="fact:x". Use after search when >50% match.`,
    args: {
      id: tool.schema.string().optional().describe("UUID from search/list results"),
      label: tool.schema.string().optional().describe("Exact label if you have it"),
      scope: tool.schema.enum(["global", "project", "all"]).optional(),
    },
    async execute(args, ctx) {
      return (memoryTool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ...args, mode: "get" }, ctx);
    },
  });
  const memorySetAlias = tool({
    description: `memory_set — alias for memory(mode="set"). USE WHEN you want to STORE new knowledge AFTER a significant tool result. Required: label, content, type. Choose type: semantic (fact/lesson/concept/decision/knowledge/architecture/how_to/preference/rule) 365d vs episodic (event/note/session/task/plan) 7d. Ex: memory_set(label="fact:auth-decision", content="We chose JWT via ...", type="fact"). Verify after with learn(mode=verify).`,
    args: {
      label: tool.schema.string().describe("Unique label — e.g. 'fact:my-decision', 'lesson:bug-2026-09-05'"),
      content: tool.schema.string().describe("Full node content (markdown) — what + why it helps future-you"),
      type: tool.schema.string().describe("Node type — semantic: fact/lesson/concept/decision/knowledge/architecture/how_to, episodic: event/note/session/task/plan"),
      summary: tool.schema.string().optional(),
      importance: tool.schema.number().optional().describe("0-1 importance"),
      level: tool.schema.number().int().nonnegative().optional(),
      sticky: tool.schema.boolean().optional().describe("true → survives compression (use for dot:/rule:)"),
    },
    async execute(args, ctx) {
      return (memoryTool as unknown as { execute: (a: unknown, c: unknown) => Promise<string> }).execute({ ...args, mode: "set" }, ctx);
    },
  });

  const map = {
    archivecontext: compressTool,
    expand: createExpandTool(),
    memory: memoryTool,
    memory_search: memorySearchAlias,
    memory_fetch: memoryFetchAlias,
    memory_get: memoryGetAlias,
    memory_set: memorySetAlias,
    project_hub: createProjectHubTool(store),
    context: createContextTool(store, client),
    learn: createLearnTool(store, client),
    journal: createJournalTool(journalStore, journalCtx, store),
    graph: createGraphPluginTool(),
    skeletonize: createSkeletonizeTool(),
    memory_session_messages: createSessionMessagesTool(client),
  };
  memLog("info", "tool-map", "TOOL-MAP-RETURNED", { keys: Object.keys(map) });
  return map;
}
