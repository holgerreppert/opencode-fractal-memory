import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { MemoryStore } from "../../storage/sqlite";
import { MemoryCompress } from "../compress";
import { MemoryLlmCompress } from "../llm-compress";
import { MemoryCheckContext, MemoryToolStats } from "../stats";
import { MemoryTotalTokens, MemorySessionStats } from "../session";
import { MemoryInject } from "../inject";
import { MemoryMiddleTerm } from "../middle-term";
import { MemoryRecallContext } from "../recall-context";
import { MemoryCacheStatus } from "../cache-status";

const SUGGESTIONS: Record<string, string> = {
  compress: "\n\n---\nNEXT: `context(mode=check)` to verify pressure dropped, or `context(mode=recall)` to recover state.",
  check: "\n\n---\nIf >60%: `context(mode=compress)`. If >80%: compress immediately. After: `context(mode=recall)` to recover.",
  inject: "\n\n---\nNEXT: `memory(mode=search)` to find what was injected, or `learn(mode=dashboard)` for health overview.",
  total_tokens: "\n\n---\nIf memory >60%: `context(mode=compress)`. If conversation >80%: consider summary.",
  middle_term: "\n\n---\nNEXT: `context(mode=recall)` for archived context, or `memory(mode=search)` for related nodes.",
  recall: "\n\n---\nNEXT: `memory(mode=search)` for more context, or `context(mode=middle_term)` for snapshots.",
  cache_status: "\n\n---\nNEXT: `context(mode=check)` for pressure, or `memory(mode=list)` for all nodes.",
  tool_stats: "\n\n---\nNEXT: `learn(mode=dashboard)` for system health, or `context(mode=check)` for pressure.",
  session_stats: "\n\n---\nNEXT: `context(mode=check)` for current pressure, or `learn(mode=reflect)` for lessons.",
};

export function createContextTool(store: MemoryStore, client?: unknown) {
  const handlers: Record<string, ToolDefinition> = {
    compress: MemoryCompress(store),
    check: MemoryCheckContext(store),
    total_tokens: MemoryTotalTokens(store, client),
    inject: MemoryInject(store),
    middle_term: MemoryMiddleTerm(store),
    recall: MemoryRecallContext(store),
    cache_status: MemoryCacheStatus(store),
    tool_stats: MemoryToolStats(store),
    session_stats: MemorySessionStats(store),
  };

  const llmHandler = MemoryLlmCompress(store, client);

  const t = tool({
    description: `BEFORE COMPLEX TASKS: check context pressure first. Prevents performance degradation before it happens.

MODES:
  compress      — Compress old nodes into higher-level summaries. RUN WHEN >60% FULL
  llm_compress  — LLM-powered compression with richer summaries (uses session LLM)
  check         — Check memory token usage vs context limit. USE BEFORE 3+ STEP TASKS
  total_tokens  — Full token analysis: memory + conversation + cache
  inject        — Inject relevant memories with token budget management
  middle_term   — Retrieve pre-compaction context snapshots
  recall        — Recall stored context archived during compaction
  cache_status  — View working memory cache (recently accessed nodes)
  tool_stats    — Tool call statistics: cost, duration, success rate
  session_stats — Current session statistics

WORKFLOW:
  check → compress (if >60%) → llm_compress (for important nodes) → recall/middle_term (after compaction)

TIP: context(mode="check") at the START of every complex task (>3 steps).
TIP: If >60%: compress immediately. If >80%: critical — stop and compress.
TIP: After compaction: context(mode="recall") to recover archived state.`,
    args: {
      mode: tool.schema.enum(["compress", "llm_compress", "check", "total_tokens", "inject", "middle_term", "recall", "cache_status", "tool_stats", "session_stats"]).describe("Which context operation to perform"),

      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      level: tool.schema.number().int().nonnegative().optional(),
      dry_run: tool.schema.boolean().optional(),
      force: tool.schema.boolean().optional(),
      project_name: tool.schema.string().optional(),

      threshold: tool.schema.number().min(0).max(1).optional(),
      node_ids: tool.schema.array(tool.schema.string()).optional(),

      session_id: tool.schema.string().optional(),
      include_messages: tool.schema.boolean().optional(),

      query: tool.schema.string().optional(),
      maxTokens: tool.schema.number().int().positive().optional(),
      maxNodes: tool.schema.number().int().positive().optional(),
      maxLevel: tool.schema.number().int().optional(),
      minConfidence: tool.schema.number().min(0).max(1).optional(),
      budgetMode: tool.schema.enum(["dynamic", "strict"]).optional(),
      includeConfidential: tool.schema.boolean().optional(),
      costWeight: tool.schema.number().positive().optional(),
      debug: tool.schema.boolean().optional(),
      fallbackMessage: tool.schema.string().optional(),

      sessionId: tool.schema.string().optional(),
      limit: tool.schema.number().int().positive().optional(),
    },
    async execute(args, ctx) {
      const mode = args.mode as string;

      if (mode === "llm_compress") {
        const result = await llmHandler.execute(args, ctx);
        const suggestion = "\n\n---\nNEXT: `context(mode=check)` to verify compression quality, or run standard compress next.";
        if (typeof result === "string") return result + suggestion;
        return result;
      }

      const handler = handlers[mode];
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
