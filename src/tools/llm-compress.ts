import type { MemoryNodeLevel } from "../storage/types";
import type { MemoryStore } from "../storage/sqlite";
import { tool } from "@opencode-ai/plugin";
import { wrapWithTracking } from "./shared";

export function MemoryLlmCompress(store: MemoryStore, client?: unknown) {
  const t = tool({
    description: "LLM-powered compression of memory nodes. Uses the session LLM to generate richer, contextual summaries instead of regex-based extraction.",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      level: tool.schema.number().int().nonnegative().optional(),
      dry_run: tool.schema.boolean().optional().default(false),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (defaults to current project)"),
    },
    async execute(args) {
      const { scope, level, dry_run, project_name } = args;
      const effectiveProjectName = project_name ?? store.projectName;
      if (!client) {
        return "Error: No LLM client available. LLM compression requires an active session.";
      }

      if (dry_run) {
        const candidates = await store.getCompressionCandidates(scope ?? "all", (level ?? 0) as MemoryNodeLevel, undefined, undefined, effectiveProjectName);
        if (candidates.length === 0) {
          return `Dry run: no nodes to compress at level ${level ?? 0}.`;
        }
        return `Dry run: found ${candidates.length} candidates for LLM compression.\n` +
          candidates.map(c => `- ${c.id.slice(0, 8)}: ${c.content.slice(0, 50)}...`).join("\n");
      }

      const result = await store.runCompression(scope ?? "all", false, client, effectiveProjectName);
      return `LLM compression completed: ${result.compressed} nodes compressed, ${result.created} summary nodes created.`;
    },
  });
  return wrapWithTracking(t, store, "memory_llm_compress");
}

export function MemoryDetectTopics(store: MemoryStore) {
  const t = tool({
    description: "Detect topic boundaries in memory (placeholder).",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
    },
    async execute(args) {
      return "Topic detection not implemented in this build.";
    },
  });
  return wrapWithTracking(t, store, "memory_detect_topics");
}
