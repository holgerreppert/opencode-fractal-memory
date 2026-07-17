import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import { resolveNode, wrapWithTracking } from "./shared";

export function MemoryPrune(store: MemoryStore) {
  const t = tool({
    description: "Find and optionally prune stale/unused memory nodes.",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      minAccessCount: tool.schema.number().optional(),
      maxAgeDays: tool.schema.number().optional(),
      minImportance: tool.schema.number().optional(),
      excludeSticky: tool.schema.boolean().optional(),
      excludeCore: tool.schema.boolean().optional(),
      dryRun: tool.schema.boolean().optional(),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const scope = (args.scope ?? "all") as "all" | "global" | "project";
      const dryRun = args.dryRun ?? true;
      
      const result = await store.pruneNodes(scope, {
        minAccessCount: args.minAccessCount ?? 0,
        maxAgeDays: args.maxAgeDays ?? 90,
        minImportance: args.minImportance ?? 0,
        excludeSticky: args.excludeSticky ?? true,
        excludeCore: args.excludeCore ?? true,
        dryRun,
        projectName: args.project_name,
      });
      
      if (result.prunable.length === 0) {
        return "No nodes found matching pruning criteria.";
      }
      
      if (dryRun) {
        const lines = result.prunable.map(n => 
          `- ${n.id.slice(0,8)}: "${n.label ?? "(no label)"}" (accesses: ${n.accessCount}, importance: ${n.importance})`
        );
        return `Found ${result.prunable.length} prunable nodes (dry-run):\n${lines.join("\n")}\n\nRun with dryRun=false to delete these nodes.`;
      }
      
      return `Pruned ${result.pruned} nodes.`;
    },
  });
  return wrapWithTracking(t, store, "memory_prune");
}

export function MemoryVerify(store: MemoryStore) {
  const t = tool({
    description: "Verify that a memory node's information is correct.",
    args: {
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      scope: tool.schema.enum(["global", "project"]).optional(),
    },
    async execute(args) {
      const node = await resolveNode(store, args);
      const verified = await store.verifyNode(node.id);
      return `Verified node ${node.id.slice(0,8)}. Confidence: ${(verified.confidence * 100).toFixed(0)}%, last_verified: ${verified.lastVerified ? new Date(verified.lastVerified).toISOString() : "never"}.`;
    },
  });
  return wrapWithTracking(t, store, "memory_verify");
}

export function MemoryCompress(store: MemoryStore) {
  const t = tool({
    description: "Compress old memory nodes into summaries at higher levels.",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      level: tool.schema.number().int().nonnegative().optional(),
      dry_run: tool.schema.boolean().optional(),
      force: tool.schema.boolean().optional(),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const scope = (args.scope ?? "all") as "all" | "global" | "project";
      const level = (args.level ?? 0) as 0 | 1 | 2 | 3 | 4 | 5;
      if (args.dry_run) {
        const candidates = await store.getCompressionCandidates(scope, level, undefined, args.force, args.project_name);
        if (candidates.length === 0) {
          return `No nodes need compression at level ${level}${args.force ? " (force)" : ""}.`;
        }
        return `Found ${candidates.length} nodes to compress:\n` + 
          candidates.map(c => `- ${c.id.slice(0,8)}: ${c.content.slice(0, 50)}...`).join("\n");
      }
      
      const candidates = await store.getCompressionCandidates(scope, level, undefined, args.force, args.project_name);
      if (candidates.length === 0) {
        return `No nodes to compress at level ${level}${args.force ? " (force)" : ""}.`;
      }

      const result = await store.runCompression(scope, args.force, undefined, args.project_name);
      return `Compression complete: ${result.compressed} nodes compressed, ${result.created} summary nodes created.`;
    },
  });
  return wrapWithTracking(t, store, "memory_compress");
}

export function MemoryExtractPatterns(store: MemoryStore) {
  const t = tool({
    description: "Extract cross-layer patterns from L0 nodes and create pattern summary nodes at L1.",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      dry_run: tool.schema.boolean().optional(),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const scope = (args.scope ?? "all") as "all" | "global" | "project";
      if (args.dry_run) {
        const nodes = await store.listNodes(scope as "all" | "global" | "project", 0, undefined, undefined, undefined, args.project_name);
        const eligible = nodes.filter(n => n.content.length > 50 && !n.sticky && n.type !== "summary");
        if (eligible.length < 2) {
          return `Not enough eligible nodes for pattern extraction (need at least 2, found ${eligible.length}).`;
        }
        return `Found ${eligible.length} eligible nodes. Pattern extraction would create 1 summary node referencing all sources.`;
      }
      
      const result = await store.runPatternExtraction(scope, 2, args.project_name);
      if (result.created === 0) {
        return `No pattern extraction performed. Need at least 2 eligible nodes with patterns to extract.`;
      }
      return `Pattern extraction complete: Created 1 pattern summary node from ${result.sources} source nodes.`;
    },
  });
  return wrapWithTracking(t, store, "memory_extract_patterns");
}

export function MemorySummarize(store: MemoryStore) {
  const t = tool({
    description: "Generate an LLM prompt to summarize a memory node.",
    args: {
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      scope: tool.schema.enum(["global", "project"]).optional(),
    },
    async execute(args) {
      let node;
      if (args.id) {
        node = await store.getNode(args.id);
      } else if (args.label) {
        const scope = args.scope ?? "project";
        node = await store.getNodeByLabel(scope, args.label);
      } else {
        throw new Error("Must provide either id or label");
      }
      
      const prompt = `Create a concise summary of the following memory content. Focus on key points and essential information. Keep it under 200 words.

Memory (${node.scope}:${node.label ?? node.id.slice(0,8)}):
---
${node.content}
---

Summary:`;
      
      return `Here's a prompt you can use with an LLM to summarize this node:

${prompt}

After the LLM generates a summary, you can create a new summary node using:
  memory(mode="set", scope="${node.scope}", content="<summary from LLM>", type="summary", level=${node.level + 1}, parent_id="${node.id}")`;
    },
  });
  return wrapWithTracking(t, store, "memory_summarize");
}

export function MemoryGenerateEmbeddings(store: MemoryStore) {
  const t = tool({
    description: "Generate embeddings for existing memory nodes that don't have them.",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      level: tool.schema.number().int().nonnegative().optional(),
      dry_run: tool.schema.boolean().optional(),
    },
    async execute(args) {
      const scope = (args.scope ?? "project") as "all" | "global" | "project";
      const level = args.level as 0 | 1 | 2 | 3 | 4 | 5 | undefined;
      
      const allNodes = await store.listNodes(scope, level);
      const nodesWithoutEmbedding = allNodes.filter(n => !n.embedding);
      
      if (args.dry_run) {
        return `Found ${nodesWithoutEmbedding.length} nodes without embeddings${level !== undefined ? ` at level ${level}` : ""}.\n` +
          nodesWithoutEmbedding.slice(0, 10).map(n => `- ${n.label ?? n.id.slice(0, 8)}`).join("\n") +
          (nodesWithoutEmbedding.length > 10 ? `\n... and ${nodesWithoutEmbedding.length - 10} more` : "");
      }
      
      if (nodesWithoutEmbedding.length === 0) {
        return "All nodes already have embeddings.";
      }
      
      let generated = 0;
      let failed = 0;
      
      for (const node of nodesWithoutEmbedding) {
        try {
          const embedding = await generateEmbedding(node.content);
          await store.updateNode(node.id, { embedding });
          generated++;
        } catch {
          failed++;
        }
      }
      
      return `Generated embeddings for ${generated} nodes${failed > 0 ? `, ${failed} failed` : ""}.`;
    },
  });
  return wrapWithTracking(t, store, "memory_generate_embeddings");
}