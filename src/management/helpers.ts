import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";
import { generateEmbedding } from "../embeddings";
import { memLog } from "../logging";

export const DB_PATHS: Record<string, string> = {};

export function initDbPaths(_projectDir: string) {
  const unifiedDbPath = path.join(os.homedir(), ".config", "opencode", "memory.db");
  DB_PATHS.global = unifiedDbPath;
  DB_PATHS.project = unifiedDbPath;
}

export function openDb(scope: string): Database | null {
  const dbPath = DB_PATHS[scope] || scope;
  if (!Bun.file(dbPath).exists()) return null;
  const db = Database.open(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");
  return db;
}

export async function withDb<T>(dbOrScope: string | Database | null, fn: (db: Database) => T): Promise<T> {
  const db = typeof dbOrScope === "string" ? openDb(dbOrScope) : dbOrScope;
  if (!db) throw new Error("Database not found");
  try {
    return await fn(db);
  } finally {
    if (typeof dbOrScope === "string") db.close();
  }
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
  try {
    const ext = path.extname(filePath);
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";
    const body = Bun.file(filePath);
    return new Response(body, { headers: { "Content-Type": mimeType } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function rowToNode(r: any) {
  return {
    id: r.id,
    label: r.label || "",
    content: r.content,
    summary: r.summary,
    level: r.level,
    type: r.type,
    importance: r.importance,
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
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    projectName: r.project_name ?? null,
  };
}

export function queryNodes(scope: string) {
  const db = openDb(scope);
  if (!db) return [];
  const rows = db.query(`
    SELECT id, label, content, summary, level, type, importance,
           usefulness_score, times_used, times_helpful, access_count,
           sticky, confidence, created_at, updated_at, parent_ids,
           LENGTH(content) as content_length, metadata, project_name
    FROM memory_nodes
    WHERE scope = ?
    ORDER BY level, importance DESC
  `).all(scope);
  db.close();
  return rows.map((r: any) => rowToNode(r));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

export function extractLinks(nodes: any[]) {
  const links: any[] = [];
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
    let match;
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
  return Object.entries(DB_PATHS)
    .filter(([_, p]) => Bun.file(p).exists())
    .map(([k, v]) => ({ scope: k, path: v }));
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
  unknown: "sphere",
};

export const CUSTOM_TYPE_SHAPES: Record<string, string> = {
  "middle-term": "torus",
};

export function resolveNodeShape(node: any): string {
  const customType = node.metadata?.customType;
  if (customType && CUSTOM_TYPE_SHAPES[customType]) {
    return CUSTOM_TYPE_SHAPES[customType];
  }
  return TYPE_SHAPES[node.type] ?? "sphere";
}

export function computeStats(nodes: any[]) {
  const nodesPerLevel: Record<number, number> = {};
  const nodesPerType: Record<string, number> = {};
  const nodesPerCustomType: Record<string, number> = {};
  const nodesPerShape: Record<string, number> = {};
  const nodesPerProject: Record<string, number> = {};
  let totalImportance = 0;
  let totalUsefulness = 0;
  let totalAccessCount = 0;
  let stickyCount = 0;
  for (const node of nodes) {
    nodesPerLevel[node.level] = (nodesPerLevel[node.level] ?? 0) + 1;
    const typeKey = node.type || "unknown";
    nodesPerType[typeKey] = (nodesPerType[typeKey] ?? 0) + 1;
    const customType = node.metadata?.customType;
    if (customType) {
      nodesPerCustomType[customType] = (nodesPerCustomType[customType] ?? 0) + 1;
    }
    const shape = resolveNodeShape(node);
    nodesPerShape[shape] = (nodesPerShape[shape] ?? 0) + 1;
    const project = node.projectName || "(default)";
    nodesPerProject[project] = (nodesPerProject[project] ?? 0) + 1;
    totalImportance += node.importance;
    totalUsefulness += node.usefulnessScore;
    totalAccessCount += node.accessCount;
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
    avgImportance: Math.round((totalImportance / n) * 100) / 100,
    avgUsefulness: Math.round((totalUsefulness / n) * 100) / 100,
    totalAccessCount,
    stickyCount,
  };
}

export function getAvailableProjects(scope: string): string[] {
  const db = openDb(scope);
  if (!db) return [];
  const rows = db.query(`
    SELECT DISTINCT COALESCE(project_name, '') as project_name
    FROM memory_nodes
    WHERE scope = ?
    ORDER BY project_name
  `).all(scope) as { project_name: string }[];
  db.close();
  return rows.map(r => r.project_name || "(default)");
}

export function readProjectConfig(): Record<string, unknown> {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-mem.json");
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(raw);
    }
  } catch { }
  return {};
}

export function writeProjectConfig(config: Record<string, unknown>): string {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-mem.json");
  try {
    const merged = { ...config };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    memLog("info", "config", "[config] Saved to:", { configPath });
    return "ok";
  } catch (e) {
    memLog("error", "config", "[config] Write error:", { error: e instanceof Error ? e.message : e });
    return String(e);
  }
}
