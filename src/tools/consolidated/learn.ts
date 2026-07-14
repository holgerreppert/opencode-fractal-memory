import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { MemoryStore } from "../../storage/sqlite";
import { MemoryVerify } from "../compress";
import { MemoryRate } from "../core";
import { MemoryStats, MemoryInjectionStats, MemoryInjectionFeedback } from "../stats";
import { MemoryReflect, MemoryDistill } from "../reflect";
import { MemoryExtractPatterns } from "../compress";
import { MemoryDashboard } from "../dashboard";
import { MemoryTemporalEdges } from "../temporal";

const SUGGESTIONS: Record<string, string> = {
  reflect: "\n\n---\nNEXT: `learn(mode=distill)` to extract actionable rules from lessons, or `learn(mode=dashboard)` for health.",
  distill: "\n\n---\nNEXT: `context(mode=check)` to verify changes, or `learn(mode=dashboard)` to see updated rules.",
  verify: "\n\n---\nNEXT: `message` to continue work, or `learn(mode=rate)` to adjust usefulness.",
  rate: "\n\n---\nNEXT: `learn(mode=verify)` to certify correctness, or `learn(mode=stats)` for overview.",
  stats: "\n\n---\nNEXT: `learn(mode=dashboard)` for visual overview, or `context(mode=check)` for pressure.",
  dashboard: "\n\n---\nNEXT: `learn(mode=stats)` for details, or `context(mode=check)` for context pressure.",
  temporal_edges: "\n\n---\nNEXT: `memory(mode=search)` for more context, or `learn(mode=stats)` for overview.",
  extract_patterns: "\n\n---\nNEXT: `context(mode=compress)` to promote patterns to higher levels.",
  injection_stats: "\n\n---\nNEXT: `learn(mode=injection_feedback)` to rate injection quality.",
  injection_feedback: "\n\n---\nNEXT: `context(mode=inject)` for automatic injection, or `memory(mode=search)` to find nodes.",
};

export function createLearnTool(store: MemoryStore, client?: unknown) {
  const handlers: Record<string, ToolDefinition> = {
    reflect: MemoryReflect(store, client),
    distill: MemoryDistill(store, client),
    verify: MemoryVerify(store),
    rate: MemoryRate(store),
    stats: MemoryStats(store),
    dashboard: MemoryDashboard(store),
    temporal_edges: MemoryTemporalEdges(store),
    extract_patterns: MemoryExtractPatterns(store),
    injection_stats: MemoryInjectionStats(store),
    injection_feedback: MemoryInjectionFeedback(store),
  };

  const t = tool({
    description: `Multi-mode learning and quality improvement tool for memory nodes.

MODES:
  reflect           — Analyze a session to create lesson nodes from failures
  distill           — Extract actionable rules from lesson nodes (run after reflect)
  verify            — Certify that a memory node's information is correct (boosts confidence)
  rate              — Rate a node's usefulness (helps retrieval quality)
  stats             — Fractal memory statistics (nodes per level, compression ratios)
  dashboard         — Visual overview: top nodes, type distribution, compression health
  temporal_edges    — Explore conversation flow (NEXT/DURING_SESSION edges)
  extract_patterns  — Find cross-node patterns, create summary nodes
  injection_stats   — Injection efficiency metrics
  injection_feedback — Rate injected memories for quality

WORKFLOW:
  reflect → distill (improve rules) | verify → rate (improve quality) | stats → dashboard (health check)

TIP: Run learn(mode=reflect) after session ends to learn from mistakes.
TIP: Run learn(mode=verify) after storing important information.
TIP: Run learn(mode=dashboard) weekly to monitor memory system health.`,
    args: {
      mode: tool.schema.enum(["reflect", "distill", "verify", "rate", "stats", "dashboard", "temporal_edges", "extract_patterns", "injection_stats", "injection_feedback"]).describe("Which learning/quality operation to perform"),

      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      project_name: tool.schema.string().optional(),

      reflect: tool.schema.boolean().optional(),
      session_id: tool.schema.string().optional(),
      dry_run: tool.schema.boolean().optional(),
      use_llm: tool.schema.boolean().optional(),

      helpful: tool.schema.boolean().optional(),
      usefulness_score: tool.schema.number().min(0).max(5).optional(),

      limit: tool.schema.number().min(1).max(100).optional(),
      show_tree_depth: tool.schema.boolean().optional(),
      show_embedding_coverage: tool.schema.boolean().optional(),

      node_id: tool.schema.string().optional(),
      direction: tool.schema.enum(["outgoing", "incoming", "both"]).optional(),
      edge_type: tool.schema.string().optional(),

      upvotes: tool.schema.number().min(0).optional(),
      downvotes: tool.schema.number().min(0).optional(),
      task_outcome: tool.schema.enum(["success", "partial", "failed"]).optional(),
      needed_nodes: tool.schema.array(tool.schema.string()).optional(),
    },
    async execute(args, ctx) {
      const mode = args.mode as string;
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
