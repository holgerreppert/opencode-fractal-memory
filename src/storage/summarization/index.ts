import type { MemoryNode, MemoryNodeLevel } from "../types";
import { cosineSimilarity } from "../../math";
import {
  generateSummary,
  generateStructuredSummary,
  generateLLMSummaryPrompt,
} from "./formatters";
import { extractPatterns as ep, generatePatternSummary } from "./patterns";

export { generateSummary, generateStructuredSummary, generateLLMSummaryPrompt } from "./formatters";
export { extractPatterns, generatePatternSummary } from "./patterns";

export const COMPRESSION_LEVELS: Record<number, { maxAgeMs: number; nextLevel: number; label: string; format: string }> = {
  0: { maxAgeMs: 7 * 24 * 60 * 60 * 1000, nextLevel: 1, label: "Weekly", format: "events" },
  1: { maxAgeMs: 30 * 24 * 60 * 60 * 1000, nextLevel: 2, label: "Monthly", format: "themes" },
  2: { maxAgeMs: 90 * 24 * 60 * 60 * 1000, nextLevel: 3, label: "Quarterly", format: "trends" },
  3: { maxAgeMs: 365 * 24 * 60 * 60 * 1000, nextLevel: 4, label: "Yearly", format: "milestones" },
};

export class CompressionHelper {
  static async findCompressionCandidates(
    nodes: MemoryNode[],
    level: MemoryNodeLevel,
    maxAgeMs?: number,
    force?: boolean
  ): Promise<MemoryNode[]> {
    const config = COMPRESSION_LEVELS[level as keyof typeof COMPRESSION_LEVELS];
    if (!config) return [];

    if (force) {
      return nodes.filter(n =>
        n.level === level && n.content.length > 100 && !n.sticky
      );
    }

    const threshold = maxAgeMs ?? config.maxAgeMs;
    const cutoffTime = Date.now() - threshold;

    return nodes.filter(n =>
      n.level === level &&
      n.updatedAt.getTime() < cutoffTime &&
      n.content.length > 100 &&
      !n.sticky
    );
  }

  static findRelatedNodes(
    nodes: MemoryNode[],
    threshold: number = 0.3
  ): MemoryNode[][] {
    const visited = new Set<string>();
    const clusters: MemoryNode[][] = [];

    for (let i = 0; i < nodes.length; i++) {
      const nodeA = nodes[i]!;
      if (visited.has(nodeA.id)) continue;
      if (!nodeA.embedding) continue;

      const cluster: MemoryNode[] = [nodeA];
      visited.add(nodeA.id);

      for (let j = i + 1; j < nodes.length; j++) {
        const nodeB = nodes[j]!;
        if (visited.has(nodeB.id)) continue;
        if (!nodeB.embedding) continue;

        const similarity = cosineSimilarity(nodeA.embedding, nodeB.embedding);
        if (similarity >= threshold) {
          cluster.push(nodeB);
          visited.add(nodeB.id);
        }
      }

      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  static generateSummary(node: MemoryNode): string {
    return generateSummary(node);
  }

  static generateLLMSummaryPrompt(node: MemoryNode): string {
    return generateLLMSummaryPrompt(node);
  }

  static generateStructuredSummary(nodes: MemoryNode[]): string {
    return generateStructuredSummary(nodes);
  }

  static async generateLLMSummary(nodes: MemoryNode[], client: unknown, maxTokens: number = 500): Promise<string> {
    const allContent = nodes.map(n =>
      `---\nLabel: ${n.label ?? "unnamed"}\nLevel: ${n.level}\nImportance: ${n.importance}\n\n${n.content}`
    ).join('\n\n');

    const prompt = `Create a structured summary of the following ${nodes.length} related memory nodes. Extract the key information and organize it into sections.

Extract:
1. Key decisions or conclusions
2. Files, libraries, or code patterns referenced
3. Tools or commands used
4. Design patterns or conventions discovered
5. Next steps or pending items

Nodes:
${allContent}

Structured summary:`;

    try {
      const sessionClient = client as { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } };
      const result = await sessionClient.session?.prompt({
        path: { id: 'compression' },
        body: {
          noReply: true,
          parts: [{ type: 'text', text: prompt }],
        },
      });

      if (result) {
        const response = await result.text();
        const trimmed = response.trim();
        if (trimmed) return trimmed;
      }
    } catch (e) {
      // LLM failed, fall through to regex fallback
    }

    return generateStructuredSummary(nodes);
  }

  static extractPatterns(nodes: MemoryNode[]): ReturnType<typeof ep> {
    return ep(nodes);
  }

  static generatePatternSummary(
    patterns: Parameters<typeof generatePatternSummary>[0],
    sourceNodeIds: string[]
  ): string {
    return generatePatternSummary(patterns, sourceNodeIds);
  }
}
