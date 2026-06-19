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

export function formatNodeForInjection(node: MemoryNode, maxTokensPerNode: number, score?: number): Record<string, unknown> {
  const item: Record<string, unknown> = {
    label: node.label ?? node.id,
  };
  if (score !== undefined) item.score = score;

  if (node.label?.startsWith("middle-term:") || node.metadata?.customType === "middle-term") {
    try {
      const parsed = JSON.parse(node.content);
      item.type = "middle-term";
      item.sessionId = parsed.sessionId;
      item.timestamp = parsed.timestamp;
      item.workingCacheCount = parsed.workingCache?.length || 0;
      item.recentNodesCount = parsed.recentNodes?.length || 0;
      item.contextTokens = parsed.contextTokens;
      return item;
    } catch {
    }
  }

  const cleaned = cleanContent(node.content);
  const truncated = truncateContent(cleaned, maxTokensPerNode);
  item.content = truncated;
  return item;
}

export function formatNodeAsLine(node: MemoryNode, score?: number, maxChars = 200): string {
  const label = node.label ?? node.id.slice(0, 12);
  const type = node.type ?? "";
  const summary = node.summary
    ? node.summary.slice(0, maxChars)
    : cleanContent(node.content).slice(0, maxChars);
  const scoreStr = score !== undefined ? ` [score:${score.toFixed(2)}]` : "";
  const typeStr = type ? ` [type:${type}]` : "";
  return `- ${label}${typeStr}${scoreStr}: ${summary}`;
}
