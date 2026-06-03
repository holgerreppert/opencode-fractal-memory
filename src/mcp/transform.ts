import type { MemoryNode, MemoryScope, MemoryStore } from "../storage/sqlite";
import { mcpLog } from "./logging";

export function nodeToPlain(n: MemoryNode) {
  return {
    id: n.id,
    label: n.label ?? "",
    content: n.content,
    summary: n.summary,
    level: n.level,
    type: n.type,
    importance: n.importance,
    usefulnessScore: n.usefulnessScore,
    timesUsed: n.timesUsed,
    timesHelpful: n.timesHelpful,
    accessCount: n.accessCount,
    sticky: n.sticky,
    confidence: n.confidence,
    createdAt: n.createdAt instanceof Date ? n.createdAt.getTime() : n.createdAt,
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.getTime() : n.updatedAt,
    parentIds: n.parentIds,
    contentLength: n.content.length,
    metadata: n.metadata,
  };
}

export function ensureScope(s: string | undefined, defaultScope: MemoryScope = "project"): MemoryScope {
  if (s === "global" || s === "project") return s;
  return defaultScope;
}

export async function resourceStats(scope: MemoryScope, store: MemoryStore) {
  try {
    const [stats, nodes] = await Promise.all([
      store.getFractalStats(scope),
      store.listNodes(scope),
    ]);
    const total = stats.totalNodes;
    const avgImportance = total > 0 ? nodes.reduce((s, n) => s + n.importance, 0) / total : 0;
    const avgUsefulness = total > 0 ? nodes.reduce((s, n) => s + (n.usefulnessScore ?? 0), 0) / total : 0;

    return JSON.stringify({
      scope,
      totalNodes: total,
      nodesPerLevel: stats.nodesPerLevel,
      avgImportance: Math.round(avgImportance * 100) / 100,
      avgUsefulness: Math.round(avgUsefulness * 100) / 100,
    }, null, 2);
  } catch {
    return JSON.stringify({ scope, error: "Database not found" });
  }
}
