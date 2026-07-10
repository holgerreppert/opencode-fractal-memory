import { Database } from "bun:sqlite";
import type { MemoryScope, MemoryNode, MemoryNodeLevel, CreateNodeInput } from "./types";
import type { SqliteNode } from "./queries/base";
import { rowToNode } from "./queries/base";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import { CompressionHelper, COMPRESSION_LEVELS } from "./summarization";

export async function getCompressionCandidates(
  getDb: (scope: MemoryScope) => Promise<Database>,
  scope: MemoryScope | "all",
  level: MemoryNodeLevel,
  maxAgeMs?: number,
  force?: boolean,
  projectName?: string
): Promise<MemoryNode[]> {
  const config = COMPRESSION_LEVELS[level];
  if (!config) return [];

  const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];
  const candidates: MemoryNode[] = [];

  for (const s of scopes) {
    const db = await getDb(s);
    const projectFilter = projectName !== undefined && s === "project";
    const projectClause = projectFilter ? " AND project_name = ?" : "";

    if (force) {
      const sql = `SELECT * FROM memory_nodes WHERE scope = ? AND level = ? AND length(content) > 100 AND (sticky IS NULL OR sticky = 0)${projectClause} ORDER BY importance DESC`;
      const params: (string | number)[] = [s, level];
      if (projectFilter) params.push(projectName!);
      const rows = db.query(sql).all(...params) as SqliteNode[];
      candidates.push(...rows.map(rowToNode));
    } else {
      const threshold = maxAgeMs ?? config.maxAgeMs;
      const cutoffTime = Date.now() - threshold;
      const sql = `SELECT * FROM memory_nodes WHERE scope = ? AND level = ? AND updated_at < ? AND length(content) > 100 AND (sticky IS NULL OR sticky = 0)${projectClause} ORDER BY importance DESC`;
      const params: (string | number)[] = [s, level, cutoffTime];
      if (projectFilter) params.push(projectName!);
      const rows = db.query(sql).all(...params) as SqliteNode[];
      candidates.push(...rows.map(rowToNode));
    }
  }

  return candidates;
}

export async function runCompression(
  deps: {
    getCompressionCandidates: (scope: MemoryScope | "all", level: MemoryNodeLevel, maxAgeMs?: number, force?: boolean) => Promise<MemoryNode[]>;
    createNode: (node: CreateNodeInput) => Promise<MemoryNode>;
    updateNode: (id: string, updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "metadata" | "embedding" | "sticky" | "confidence" | "usefulnessScore" | "timesHelpful">>) => Promise<void>;
  },
  scope: MemoryScope | "all",
  force?: boolean,
  client?: unknown,
  sessionId?: string,
): Promise<{ compressed: number; created: number }> {
  let compressed = 0;
  let created = 0;

  const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];

  for (const s of scopes) {
    for (const level of [0, 1, 2, 3] as MemoryNodeLevel[]) {
      const config = COMPRESSION_LEVELS[level];
      if (!config) continue;

      const candidates = await deps.getCompressionCandidates(s, level, undefined, force);

      const clusters = CompressionHelper.findRelatedNodes(candidates, 0.3);

      for (const cluster of clusters) {
        const useLlm = !!client;
        const summary = useLlm
          ? await CompressionHelper.generateLLMSummary(cluster, client, 500, sessionId)
          : CompressionHelper.generateStructuredSummary(cluster);

        let summaryEmbedding: number[] | null = null;
        try {
          summaryEmbedding = await generateEmbedding(summary);
        } catch {
          // Embedding generation failed, continue without it
        }

        const summaryNode = await deps.createNode({
          scope: s,
          label: `summary-l${config.nextLevel}-group-${Date.now()}`,
          content: summary,
          summary: `Fractal summary of ${cluster.length} related nodes`,
          level: config.nextLevel as MemoryNodeLevel,
          parentIds: cluster.map((node: MemoryNode) => node.id),
          embedding: summaryEmbedding,
          importance: Math.max(...cluster.map((n: MemoryNode) => n.importance)) * 0.9,
          type: "summary",
          source: "llm_compress",
          tags: ["fractal-summary", "compression"],
          metadata: null,
        });

        for (const node of cluster) {
          await deps.updateNode(node.id, {
            summary: `Group compressed into ${summaryNode.id.slice(0, 8)}`,
          });
        }

        compressed += cluster.length;
        created++;
      }
    }
  }

  return { compressed, created };
}

export async function runPatternExtraction(
  deps: {
    listNodes: (scope: MemoryScope | "all", level?: MemoryNodeLevel, limit?: number, offset?: number, includeExpired?: boolean, projectName?: string) => Promise<MemoryNode[]>;
    createNode: (node: CreateNodeInput) => Promise<MemoryNode>;
    updateNode: (id: string, updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "metadata" | "embedding" | "sticky" | "confidence" | "usefulnessScore" | "timesHelpful">>) => Promise<void>;
  },
  scope: MemoryScope | "all",
  _minSourceCount: number = 2,
  _projectName?: string
): Promise<{ created: number; sources: number }> {
  let created = 0;
  let sources = 0;

  const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];

  for (const s of scopes) {
    const nodes = await deps.listNodes(s, 0);
    const eligibleNodes = (nodes as MemoryNode[]).filter((n: MemoryNode) =>
      n.content.length > 50 &&
      !n.sticky &&
      n.type !== "summary"
    );

    if (eligibleNodes.length < 2) continue;

    const patterns = CompressionHelper.extractPatterns(eligibleNodes);
    const sourceNodeIds = eligibleNodes.map((n: MemoryNode) => n.id);
    sources = sourceNodeIds.length;

    const totalPatternCount =
      patterns.decisions.size +
      patterns.preferences.size +
      patterns.conventions.size +
      patterns.tools.size +
      patterns.files.size;

    if (totalPatternCount === 0) continue;

    const summary = CompressionHelper.generatePatternSummary(patterns, sourceNodeIds);

    let summaryEmbedding: number[] | null = null;
    try {
      summaryEmbedding = await generateEmbedding(summary);
    } catch {
      // Embedding generation failed, continue without it
    }

    const summaryNode = await deps.createNode({
      scope: s,
      label: `patterns-${Date.now()}`,
      content: summary,
      summary: `Cross-layer patterns extracted from ${sourceNodeIds.length} nodes`,
      level: 1,
      parentIds: sourceNodeIds,
      embedding: summaryEmbedding,
      importance: 0.7,
      type: "summary",
      source: "llm_compress",
      tags: ["extracted-patterns"],
      metadata: {
        patternTypes: [
          patterns.decisions.size > 0 ? "decisions" : null,
          patterns.preferences.size > 0 ? "preferences" : null,
          patterns.conventions.size > 0 ? "conventions" : null,
          patterns.tools.size > 0 ? "tools" : null,
          patterns.files.size > 0 ? "files" : null,
        ].filter(Boolean),
      },
    });

    for (const node of eligibleNodes) {
      await deps.updateNode(node.id, {
        summary: `Pattern extraction: ${summaryNode.id.slice(0, 8)}`,
      });
    }

    created++;
  }

  return { created, sources };
}
