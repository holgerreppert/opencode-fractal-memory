import { jsonResponse } from "../helpers";

export { jsonResponse };

export function mapNode(n: {
  id: string; label: string | null; content: string; summary: string | null;
  level: number; type: string | null; importance: number;
  usefulnessScore: number | null; timesUsed: number | null; timesHelpful: number | null;
  accessCount: number | null; sticky: boolean; confidence: number | null;
  verificationCount: number | null;
  supertype: string | null; domain: string | null; tags: string[] | null; source: string | null;
  createdAt: Date; updatedAt: Date; lastAccessed: Date | null;
  parentIds: string[] | null;
  metadata: Record<string, unknown> | null;
  projectName: string | null;
}) {
  return {
    id: n.id,
    label: n.label || "",
    content: n.content,
    summary: n.summary,
    level: n.level,
    type: n.type,
    supertype: n.supertype,
    domain: n.domain,
    tags: n.tags,
    source: n.source,
    importance: n.importance,
    usefulnessScore: n.usefulnessScore,
    timesUsed: n.timesUsed,
    timesHelpful: n.timesHelpful,
    accessCount: n.accessCount,
    sticky: !!n.sticky,
    confidence: n.confidence,
    verificationCount: n.verificationCount ?? 0,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    lastAccessed: n.lastAccessed,
    parentIds: n.parentIds ? (typeof n.parentIds === "string" ? JSON.parse(n.parentIds) : n.parentIds) : null,
    metadata: n.metadata ? (typeof n.metadata === "string" ? JSON.parse(n.metadata) : n.metadata) : null,
    projectName: n.projectName ?? null,
  };
}
