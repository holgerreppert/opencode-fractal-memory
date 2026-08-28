import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { memLog } from "../logging";
import { scopeDbPath } from "../infrastructure/db/DbProvider";
export {
  getProjectDir, getProjectName, getConfigDir, getBackupDir,
  getBackupSources, formatSize,
  createBackup, listBackups, deleteBackup, restoreBackup,
} from "./backup-ops";
export type {
  BackupSourceInfo, BackupManifest, BackupEntry,
} from "./backup-ops";

interface DbRow {
  id: string;
  label: string | null;
  content: string;
  summary: string | null;
  level: number | null;
  type: string | null;
  domain: string | null;
  importance: number | null;
  usefulness_score: number | null;
  times_used: number | null;
  times_helpful: number | null;
  access_count: number | null;
  sticky: number;
  confidence: number | null;
  created_at: number;
  updated_at: number;
  parent_ids: string | null;
  content_length: number;
  metadata: string | null;
  project_name: string | null;
}

interface MgmtNode {
  id: string;
  label: string;
  content: string;
  summary: string | null;
  level: number;
  type: string | null;
  domain: string | null;
  importance: number;
  usefulnessScore: number | null;
  timesUsed: number | null;
  timesHelpful: number | null;
  accessCount: number | null;
  sticky: boolean;
  confidence: number | null;
  createdAt: number;
  updatedAt: number;
  parentIds: string[] | null;
  contentLength: number;
  metadata: Record<string, unknown> | null;
  projectName: string | null;
}

interface NodeLike {
  id: string;
  label: string | null;
  content: string;
  type: string | null;
  domain: string | null;
  level: number;
  importance: number;
  usefulnessScore: number | null;
  accessCount: number | null;
  sticky: boolean;
  projectName: string | null;
  metadata: Record<string, unknown> | null;
  parentIds: string[] | null;
  supertype: string | null;
  tags: string[] | null;
  confidence: number | null;
  verificationCount: number | null;
  lastAccessed: Date | null;
  source: string | null;
  status: string | null;
  supersedesId: string | null;
  subtask?: string | null;
}

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function serveFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }
  const ext = path.extname(filePath);
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  return new Response(content, { headers: { "Content-Type": mimeType, "Cache-Control": "no-cache" } });
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
}

export function rowToNode(r: DbRow): MgmtNode {
  return {
    id: r.id,
    label: r.label || "",
    content: r.content,
    summary: r.summary,
    level: r.level ?? 0,
    type: r.type,
    domain: r.domain,
    importance: r.importance ?? 0.5,
    usefulnessScore: r.usefulness_score,
    timesUsed: r.times_used,
    timesHelpful: r.times_helpful,
    accessCount: r.access_count,
    sticky: !!r.sticky,
    confidence: r.confidence,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    parentIds: r.parent_ids ? JSON.parse(r.parent_ids) : null,
    contentLength: r.content_length,
    metadata: r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : null,
    projectName: r.project_name ?? null,
  };
}



export function extractLinks(nodes: NodeLike[]) {
  const links: Array<{ source: string; target: string; type: string }> = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.parentIds) {
      for (const parentId of node.parentIds) {
        if (nodeMap.has(parentId)) {
          const key = `${node.id}-${parentId}-parent`;
          if (!seen.has(key)) {
            seen.add(key);
            links.push({ source: node.id, target: parentId, type: "parent" });
          }
        }
      }
    }
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiLinkRegex.exec(node.content)) !== null) {
      const targetLabel = match[1];
      const target = nodes.find(n => n.label === targetLabel);
      if (target && target.id !== node.id) {
        const key = `${node.id}-${target.id}-link`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: node.id, target: target.id, type: "link" });
        }
      }
    }
  }
  return links;
}

export function getAvailableScopes(): Array<{ scope: string; path: string }> {
  const dbPath = scopeDbPath(os.homedir(), "global");
  if (!fs.existsSync(dbPath)) return [];
  return [
    { scope: "global", path: dbPath },
    { scope: "project", path: dbPath },
  ];
}

export const TYPE_SHAPES: Record<string, string> = {
  note: "sphere",
  event: "box",
  episode: "box",
  concept: "octahedron",
  summary: "octahedron",
  core: "dodecahedron",
  improvement: "sphere",
  howto: "sphere",
  skill: "icosahedron",
  playbook: "torus",
  fact: "octahedron",
  lesson: "dodecahedron",
  rule: "icosahedron",
  decision: "dodecahedron",
  architecture: "box",
  preference: "sphere",
  convention: "box",
  knowledge: "octahedron",
  research: "octahedron",
  bug: "box",
  fix: "box",
  plan: "torus",
  task: "sphere",
  exploration: "box",
  "debug-investigation": "box",
  review: "sphere",
  session: "sphere",
  playbook_version: "torus",
  unknown: "sphere",
};

export const CUSTOM_TYPE_SHAPES: Record<string, string> = {
  "middle-term": "torus",
};

export function resolveNodeShape(node: { type?: string | null; metadata?: Record<string, unknown> | null }): string {
  const customType = node.metadata?.customType as string | undefined;
  if (customType && CUSTOM_TYPE_SHAPES[customType]) {
    return CUSTOM_TYPE_SHAPES[customType];
  }
  return TYPE_SHAPES[node.type ?? ""] ?? "sphere";
}

export interface StatsResult {
  totalNodes: number;
  nodesPerLevel: Record<number, number>;
  nodesPerType: Record<string, number>;
  nodesPerCustomType: Record<string, number>;
  nodesPerShape: Record<string, number>;
  nodesPerProject: Record<string, number>;
  nodesPerSupertype: Record<string, number>;
  nodesPerDomain: Record<string, number>;
  nodesPerSource: Record<string, number>;
  nodesPerStatus: Record<string, number>;
  tagsFrequency: Record<string, number>;
  confidenceHistogram: Record<string, number>;
  stratumBreakdown: Record<string, number>;
  avgImportance: number;
  avgUsefulness: number;
  totalAccessCount: number;
  stickyCount: number;
  // Extended efficiency fields (optional, set by handleStats)
  memoryTokens?: number;
  totalChars?: number;
  compressionCalls?: number;
  compressionSavings?: number;
  originalChars?: number;
  compressedChars?: number;
  charsSaved?: number;
  injectionCount?: number;
  avgInjectionTokens?: number;
  injectionHelpfulness?: number;
}

export function computeStats(nodes: NodeLike[]): StatsResult {
  const nodesPerLevel: Record<number, number> = {};
  const nodesPerType: Record<string, number> = {};
  const nodesPerCustomType: Record<string, number> = {};
  const nodesPerShape: Record<string, number> = {};
  const nodesPerProject: Record<string, number> = {};
  const nodesPerSupertype: Record<string, number> = {};
  const nodesPerDomain: Record<string, number> = {};
  const nodesPerSource: Record<string, number> = {};
  const nodesPerStatus: Record<string, number> = {};
  const tagsFrequency: Record<string, number> = {};
  const confidenceHistogram: Record<string, number> = {};
  const stratumBreakdown: Record<string, number> = {};
  let totalImportance = 0;
  let totalUsefulness = 0;
  let totalAccessCount = 0;
  let stickyCount = 0;
  for (const node of nodes) {
    nodesPerLevel[node.level] = (nodesPerLevel[node.level] ?? 0) + 1;
    const typeKey = node.type || "unknown";
    nodesPerType[typeKey] = (nodesPerType[typeKey] ?? 0) + 1;
    const customType = node.metadata?.customType as string | undefined;
    if (customType) {
      nodesPerCustomType[customType] = (nodesPerCustomType[customType] ?? 0) + 1;
    }
    const shape = resolveNodeShape(node);
    nodesPerShape[shape] = (nodesPerShape[shape] ?? 0) + 1;
    const project = node.projectName;
    if (project && !project.startsWith("auto-edges-test-")) {
      nodesPerProject[project] = (nodesPerProject[project] ?? 0) + 1;
    }
    if (node.supertype) {
      nodesPerSupertype[node.supertype] = (nodesPerSupertype[node.supertype] ?? 0) + 1;
    }
    const domainKey = node.domain || "unset";
    nodesPerDomain[domainKey] = (nodesPerDomain[domainKey] ?? 0) + 1;
    const sourceKey = node.source || "auto";
    nodesPerSource[sourceKey] = (nodesPerSource[sourceKey] ?? 0) + 1;
    const statusKey = node.status || "active";
    nodesPerStatus[statusKey] = (nodesPerStatus[statusKey] ?? 0) + 1;
    if (node.tags) {
      for (const tag of node.tags) {
        tagsFrequency[tag] = (tagsFrequency[tag] ?? 0) + 1;
      }
    }
    const confidence = node.confidence ?? 0.5;
    const confBucket = Math.round(confidence * 10) / 10;
    const confKey = `${confBucket.toFixed(1)}-${(confBucket + 0.1).toFixed(1)}`;
    confidenceHistogram[confKey] = (confidenceHistogram[confKey] ?? 0) + 1;
    const daysSinceAccess = node.lastAccessed ? (Date.now() - node.lastAccessed.getTime()) / (1000 * 60 * 60 * 24) : Infinity;
    const stratum = daysSinceAccess < 1 ? "hot" : daysSinceAccess < 7 ? "warm" : "cold";
    stratumBreakdown[stratum] = (stratumBreakdown[stratum] ?? 0) + 1;
    totalImportance += node.importance;
    totalUsefulness += (node.usefulnessScore ?? 0);
    totalAccessCount += (node.accessCount ?? 0);
    if (node.sticky) stickyCount++;
  }
  const n = nodes.length || 1;
  return {
    totalNodes: nodes.length,
    nodesPerLevel,
    nodesPerType,
    nodesPerCustomType,
    nodesPerShape,
    nodesPerProject,
    nodesPerSupertype,
    nodesPerDomain,
    nodesPerSource,
    nodesPerStatus,
    tagsFrequency,
    confidenceHistogram,
    stratumBreakdown,
    avgImportance: Math.round((totalImportance / n) * 100) / 100,
    avgUsefulness: Math.round((totalUsefulness / n) * 100) / 100,
    totalAccessCount,
    stickyCount,
  };
}

export function getAvailableProjects(_scope: string): string[] {
  // This function is kept for compat; management routes now use store.listNodes()
  return [];
}

export function readProjectConfig(): Record<string, unknown> {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-mem.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    memLog("error", "config", "Failed to read config, using defaults", { error: String(e) });
    return {};
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key]) &&
        result[key] !== null && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function writeProjectConfig(config: Record<string, unknown>): string {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-mem.json");
  try {
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch (e) {
        memLog("error", "config", "Failed to merge existing config", { error: String(e) });
      }
    }
    const merged = deepMerge(existing, config);
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    memLog("info", "config", "[config] Saved to:", { configPath });
    return "ok";
  } catch (e) {
    memLog("error", "config", "[config] Write error:", { error: e instanceof Error ? e.message : e });
    return String(e);
  }
}


