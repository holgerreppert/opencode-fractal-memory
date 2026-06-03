import type { MemoryNode } from "../../storage/sqlite";

export function truncateContent(content: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;

  let truncated = content.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.8) {
    truncated = truncated.slice(0, lastSpace);
  }
  const lastNewline = truncated.lastIndexOf("\n");
  if (lastNewline > maxChars * 0.8) {
    truncated = truncated.slice(0, lastNewline);
  }
  return truncated.trim();
}

export function cleanContent(content: string): string {
  return content
    .replace(/^#{1,6} .*$/gm, "")
    .replace(/^tag:.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatNodeForInjection(node: MemoryNode, maxTokensPerNode: number): Record<string, unknown> {
  if (node.label?.startsWith("middle-term:") || node.metadata?.customType === "middle-term") {
    try {
      const parsed = JSON.parse(node.content);
      return {
        label: node.label ?? node.id,
        type: "middle-term",
        sessionId: parsed.sessionId,
        timestamp: parsed.timestamp,
        workingCacheCount: parsed.workingCache?.length || 0,
        recentNodesCount: parsed.recentNodes?.length || 0,
        contextTokens: parsed.contextTokens,
      };
    } catch {
      // Not valid JSON, fall through
    }
  }

  const cleaned = cleanContent(node.content);
  const truncated = truncateContent(cleaned, maxTokensPerNode);
  return {
    label: node.label ?? node.id,
    content: truncated,
  };
}
