import { tool } from "@opencode-ai/plugin";
import type { MemoryScope, MemoryStore } from "../storage/sqlite";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import { memLog, getSessionId } from "../logging";
import { onNodeCreated } from "../storage/auto-edges";
import { resolveNode, wrapWithContextWarning, wrapWithTracking } from "./shared";

// Try to generate embedding, returning null on failure instead of throwing
async function tryGenerateEmbedding(
  content: string,
  logContext?: string
): Promise<number[] | null> {
  try {
    return await generateEmbedding(content);
  } catch (err) {
    if (logContext) {
      memLog("warn", "embeddings", `${logContext}:`, { error: err instanceof Error ? err.message : err });
    }
    return null;
  }
}

// Normalize content: convert literal escape sequences to actual characters
function normalizeContent(content: string): string {
  if (!content) return content;
  return content
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function MemoryList(store: MemoryStore) {
  const t = tool({
    description: "List available memory nodes (content, level, importance).",
    args: {
      scope: tool.schema.enum(["all", "global", "project"]).optional(),
      level: tool.schema.number().int().nonnegative().optional(),
      project_name: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const scope = (args.scope ?? "all") as MemoryScope | "all";
      const level = args.level as import("../memory").MemoryNodeLevel | undefined;
      const projectName = args.project_name ?? (scope === "project" ? store.projectName : undefined);
      const nodes = await store.listNodes(scope, level, undefined, undefined, undefined, projectName);
      if (nodes.length === 0) {
        return "No memory nodes found.";
      }

      const result = nodes
        .map(
          (n) =>
            `${n.scope}:${n.id} ${n.label ? `(label: ${n.label})` : ""}\n  level=${n.level} importance=${n.importance.toFixed(2)} access=${n.accessCount}\n  type=${n.type ?? "none"}\n  ${n.content.slice(0, 100)}${n.content.length > 100 ? "..." : ""}`,
        )
        .join("\n\n");
      
      return wrapWithContextWarning(result);
    },
  });
  return wrapWithTracking(t, store, "memory_list");
}

export function MemorySet(store: MemoryStore) {
  const t = tool({
    description: "Create or update a memory node. If label is provided and a node with that label exists, updates it instead of creating new. Embeddings are auto-generated for semantic search (use no_embedding=true to disable). Use sticky=true to prevent a node from being compressed. Worth storing: architecture decisions (why), bug root causes, project conventions, user preferences, config workarounds, anti-patterns. Skip: code content (already in files), verbose logs, ephemeral chat details.",
    args: {
      scope: tool.schema.enum(["global", "project"]).optional(),
      label: tool.schema.string().optional(),
      content: tool.schema.string(),
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
    },
    async execute(args) {
      const scope = (args.scope ?? "project") as MemoryScope;
      const sticky = args.sticky ?? false;
      const ttlDays = args.ttl_days ?? undefined;
      let metadata: Record<string, unknown> | null = null;
      if (args.metadata) {
        try {
          metadata = JSON.parse(args.metadata);
        } catch {
          throw new Error("metadata must be a valid JSON string");
        }
      }
      
      if (args.label) {
        try {
          const existing = await store.getNodeByLabel(scope, args.label);
          const embedding = args.no_embedding ? null : await tryGenerateEmbedding(args.content, "Failed to regenerate embedding on update");
          const updates: Parameters<typeof store.updateNode>[1] = {
            content: normalizeContent(args.content),
            ...(args.summary !== undefined ? { summary: args.summary } : {}),
            ...(args.level !== undefined ? { level: args.level as 0 | 1 | 2 | 3 | 4 | 5 } : {}),
            ...(args.type !== undefined ? { type: args.type as "event" | "episode" | "concept" | "summary" | "core" | "note" | "skill" } : {}),
            sticky,
            ...(embedding !== null ? { embedding } : {}),
            ...(metadata !== null ? { metadata } : {}),
          };
          
          if (args.usefulness_score !== undefined) {
            (updates as Record<string, unknown>).usefulnessScore = args.usefulness_score;
          }
          if (ttlDays !== undefined) {
            (updates as Record<string, unknown>).ttlDays = ttlDays;
          }
          
          await store.updateNode(existing.id, updates);
          return `Updated memory node ${existing.id.slice(0,8)} (${scope}:${args.label})${sticky ? " [sticky]" : ""}${args.usefulness_score !== undefined ? ` usefulness: ${args.usefulness_score}/5` : ""}${embedding ? " (embedding refreshed)" : ""}${metadata ? " (metadata set)" : ""}.`;
        } catch {
          // Node doesn't exist, will create new
        }
      }
      
      const parentIds = args.parent_ids ? args.parent_ids.split(",").map(s => s.trim()).filter(Boolean) : null;
      const embedding = args.no_embedding ? null : await tryGenerateEmbedding(args.content, "Failed to generate embedding");
      
      const node = await store.createNode({
        scope,
        label: args.label,
        content: normalizeContent(args.content),
        summary: args.summary ?? null,
        level: (args.level ?? 0) as 0 | 1 | 2 | 3 | 4 | 5,
        parentIds,
        embedding,
        importance: args.importance ?? 0.5,
        type: args.type as "event" | "episode" | "concept" | "summary" | "core" | "note" | "skill" | null,
        metadata,
        sticky,
        ttlDays: ttlDays ?? null,
      });
      
      const ttlSuffix = ttlDays ? ` [TTL: ${ttlDays}d]` : "";

      const sessionId = getSessionId();
      if (sessionId) {
        onNodeCreated(store, scope, node.id, args.label, args.content, sessionId);
      }

      return `Created memory node ${node.id.slice(0,8)} at level ${node.level}${sticky ? " [sticky]" : ""}${ttlSuffix}${embedding ? " (with embedding)" : " (no embedding)"}.`;
    },
  });
  return wrapWithTracking(t, store, "memory_set");
}

export function MemoryRate(store: MemoryStore) {
  const t = tool({
    description: "Mark a memory node as helpful (or not) and optionally adjust its usefulness score.",
    args: {
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      scope: tool.schema.enum(["global", "project"]).optional(),
      helpful: tool.schema.boolean().optional(),
      usefulness_score: tool.schema.number().min(0).max(5).optional(),
    },
    async execute(args) {
      const scope = (args.scope ?? "project") as MemoryScope;
      let nodeId: string | undefined;
      if (args.id) {
        nodeId = args.id;
      } else if (args.label) {
        const node = await store.getNodeByLabel(scope, args.label);
        nodeId = node.id;
      } else {
        throw new Error("Must provide either id or label");
      }
      const updates: Record<string, unknown> = {};
      if (args.usefulness_score !== undefined) {
        updates.usefulnessScore = args.usefulness_score;
      }
      if (args.helpful) {
        const node = await store.getNode(nodeId);
        updates.timesHelpful = (node.timesHelpful ?? 0) + 1;
      }
      if (Object.keys(updates).length === 0) {
        return "No updates applied.";
      }
      await store.updateNode(nodeId, updates);
      return `Updated node ${nodeId?.slice(0,8)}: ${args.helpful ? "timesHelpful incremented" : ""}${args.usefulness_score !== undefined ? ` usefulnessScore set to ${args.usefulness_score}` : ""}`;
    },
  });
  return wrapWithTracking(t, store, "memory_rate");
}

export function MemoryGet(store: MemoryStore) {
  const t = tool({
    description: "Get a memory node by ID or label.",
    args: {
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      scope: tool.schema.enum(["global", "project"]).optional(),
    },
    async execute(args) {
      const node = await resolveNode(store, args);
      const metaSection = node.metadata ? `\nMetadata:\n${JSON.stringify(node.metadata, null, 2)}` : "";
      const result = `Scope: ${node.scope}
Level: ${node.level}
Type: ${node.type ?? "none"}
Importance: ${node.importance}
Access count: ${node.accessCount}
Created: ${node.createdAt.toISOString()}
Updated: ${node.updatedAt.toISOString()}${metaSection}

Content:
${node.content}${node.summary ? "\n\nSummary:\n" + node.summary : ""}`;
      
      return wrapWithContextWarning(result);
    },
  });
  return wrapWithTracking(t, store, "memory_get");
}

export function MemoryFetch(store: MemoryStore) {
  const t = tool({
    description: `Fetch a specific memory node by exact label. File summaries are stored with label prefix 'file:' — use memory(mode="search", query="file:<filename>") to find them.`,
    args: {
      label: tool.schema.string(),
      scope: tool.schema.enum(["global", "project"]).optional(),
    },
    async execute(args) {
      const scope = args.scope ?? "global";
      
      try {
        const node = await store.getNodeByLabel(scope, args.label);
        
        const recencyScore = node.lastAccessed 
          ? Math.exp(-(Date.now() - node.lastAccessed.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        
        const result = {
          success: true,
          node: {
            id: node.id,
            label: node.label,
            scope: node.scope,
            level: node.level,
            importance: node.importance,
            usefulnessScore: node.usefulnessScore,
            recencyScore,
            accessCount: node.accessCount,
            timesUsed: node.timesUsed,
            timesHelpful: node.timesHelpful,
            createdAt: node.createdAt.toISOString(),
            updatedAt: node.updatedAt.toISOString(),
            content: node.content,
            summary: node.summary,
          }
        };
        
        return JSON.stringify(result, null, 2);
      } catch {
        const allNodes = await store.listNodes("all");
        const similar = allNodes
          .filter(n => n.label?.toLowerCase().includes(args.label.toLowerCase()))
          .slice(0, 3)
          .map(n => n.label);
        
        return JSON.stringify({
          success: false,
          error: `Memory node not found: ${args.label}`,
          suggestions: similar.length > 0 ? similar : undefined
        }, null, 2);
      }
    },
  });
  return wrapWithTracking(t, store, "memory_fetch");
}

export function MemoryReplace(store: MemoryStore) {
  const t = tool({
    description: "Replace content in a memory node.",
    args: {
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      scope: tool.schema.enum(["global", "project"]).optional(),
      oldText: tool.schema.string(),
      newText: tool.schema.string(),
    },
    async execute(args) {
      const node = await resolveNode(store, args);
      const oldText = args.oldText;
      if (!oldText) {
        throw new Error("oldText is required");
      }
      const content = node.content;

      if (content.includes(oldText)) {
        const updated = content.replace(oldText, args.newText);
        const embedding = await tryGenerateEmbedding(updated);
        await store.updateNode(node.id, { content: updated, embedding });
        return `Updated memory node ${node.id.slice(0,8)}${embedding ? " (embedding refreshed)" : ""}.`;
      }

      const oldLines = oldText.split("\n");
      const oldTrimmedLines = oldLines.map(l => l.trim());
      const contentLines = content.split("\n");

      let matchStart = -1;
      for (let i = 0; i < contentLines.length - oldTrimmedLines.length; i++) {
        let matched = true;
        for (let j = 0; j < oldTrimmedLines.length; j++) {
          const line = contentLines[i + j];
          if (!line || line.trim() !== oldTrimmedLines[j]) {
            matched = false;
            break;
          }
        }
        if (matched) {
          matchStart = i;
          break;
        }
      }

      if (matchStart >= 0) {
        const before = contentLines.slice(0, matchStart);
        const after = contentLines.slice(matchStart + oldTrimmedLines.length);
        const newLines = args.newText.split("\n");
        const updated = [...before, ...newLines, ...after].join("\n");
        const embedding = await tryGenerateEmbedding(updated);
        await store.updateNode(node.id, { content: updated, embedding });
        return `Updated memory node ${node.id.slice(0,8)} (fuzzy match)${embedding ? " (embedding refreshed)" : ""}.`;
      }

      throw new Error(`Old text not found in node ${node.id}. Re-read the node with memory(mode="get") to get exact content.`);
    },
  });
  return wrapWithTracking(t, store, "memory_replace");
}

export function MemoryDelete(store: MemoryStore) {
  const t = tool({
    description: "Delete a memory node by ID or label.",
    args: {
      id: tool.schema.string().optional(),
      label: tool.schema.string().optional(),
      scope: tool.schema.enum(["global", "project"]).optional(),
    },
    async execute(args) {
      const node = await resolveNode(store, args);
      await store.deleteNode(node.id);
      return `Deleted memory node ${node.id.slice(0,8)}.`;
    },
  });
  return wrapWithTracking(t, store, "memory_delete");
}