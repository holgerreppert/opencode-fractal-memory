import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";
import { memLog } from "../logging";

const ALLOWED_SCOPES = new Set(["global", "project"]);

export const DB_PATHS: Record<string, string> = {};

export function initDbPaths(_projectDir: string) {
  const unifiedDbPath = path.join(os.homedir(), ".config", "opencode", "memory.db");
  DB_PATHS.global = unifiedDbPath;
  DB_PATHS.project = unifiedDbPath;
}

export function openDb(scope: string): Database | null {
  if (!ALLOWED_SCOPES.has(scope)) return null;
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
  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }
  const ext = path.extname(filePath);
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  const body = Bun.file(filePath);
  return new Response(body, { headers: { "Content-Type": mimeType, "Cache-Control": "no-cache" } });
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
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

export function queryNodes(scope: string, projectName?: string) {
  const db = openDb(scope);
  if (!db) return [];
  let sql = `
    SELECT id, label, content, summary, level, type, importance,
           usefulness_score, times_used, times_helpful, access_count,
           sticky, confidence, created_at, updated_at, parent_ids,
           LENGTH(content) as content_length, metadata, project_name
    FROM memory_nodes
    WHERE scope = ?
  `;
  const params: (string | number)[] = [scope];
  if (projectName) {
    sql += ` AND project_name = ?`;
    params.push(projectName);
  }
  sql += ` ORDER BY level, importance DESC`;
  const rows = db.query(sql).all(...params);
  db.close();
  return rows.map((r: any) => rowToNode(r));
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

export function queryTemporalEdges(scope: string, projectName?: string, nodeId?: string) {
  const db = openDb(scope);
  if (!db) return [];
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  conditions.push("(n1.scope = ? OR n2.scope = ?)");
  params.push(scope, scope);
  if (nodeId) {
    conditions.push("(te.source_node_id = ? OR te.target_node_id = ?)");
    params.push(nodeId, nodeId);
  }
  if (projectName) {
    conditions.push("(n1.project_name = ? OR n2.project_name = ?)");
    params.push(projectName, projectName);
  }
  const sql = `
    SELECT te.id, te.source_node_id, te.target_node_id, te.edge_type,
           te.confidence, te.created_at, te.metadata,
           n1.label as source_label, n2.label as target_label
    FROM temporal_edges te
    LEFT JOIN memory_nodes n1 ON te.source_node_id = n1.id
    LEFT JOIN memory_nodes n2 ON te.target_node_id = n2.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY te.created_at DESC
  `;
  const rows = db.query(sql).all(...params) as any[];
  db.close();
  return rows;
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

// ==================== Backup / Restore ====================

export interface BackupSourceInfo {
  key: string;
  label: string;
  files: Array<{ original: string; }>;
  exists: boolean;
  isDir: boolean;
}

export interface BackupManifest {
  name: string;
  date: string;
  label?: string;
  sources: Record<string, {
    label: string;
    files: Array<{ original: string; stored: string; size: number; }>;
    totalSize: number;
  }>;
  totalSize: number;
}

export interface BackupEntry {
  name: string;
  date: string;
  label?: string;
  totalSize: number;
  sources: Record<string, {
    label: string;
    fileCount: number;
    totalSize: number;
  }>;
}

export function getBackupDir(): string {
  return path.join(getConfigDir(), "backups");
}

export function getProjectDir(): string {
  return process.env.MGMT_PROJECT_DIR || process.cwd();
}

export function getConfigDir(): string {
  return process.env.MGMT_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
}

export function getBackupSources(): BackupSourceInfo[] {
  const projectDir = getProjectDir();
  const configDir = getConfigDir();

  const dbPath = path.join(configDir, "memory.db");
  const globalConfig = path.join(configDir, "opencode-mem.json");
  const projectConfigJsonc = path.join(projectDir, "opencode-mem.jsonc");
  const projectConfigJson = path.join(projectDir, "opencode-mem.json");
  const globalOpenCode = path.join(configDir, "opencode.json");
  const projectOpenCode = path.join(projectDir, ".opencode", "opencode.json");
  const journalDir = path.join(configDir, "journal");

  const configFiles: Array<{ original: string; }> = [];
  for (const fp of [globalConfig, projectConfigJsonc, projectConfigJson]) {
    if (fs.existsSync(fp)) configFiles.push({ original: fp });
  }

  const opencodeFiles: Array<{ original: string; }> = [];
  for (const fp of [globalOpenCode, projectOpenCode]) {
    if (fs.existsSync(fp)) opencodeFiles.push({ original: fp });
  }

  return [
    {
      key: "db",
      label: "Memory Database",
      files: [{ original: dbPath }],
      exists: fs.existsSync(dbPath),
      isDir: false,
    },
    {
      key: "config",
      label: "Plugin Config",
      files: configFiles,
      exists: configFiles.length > 0,
      isDir: false,
    },
    {
      key: "opencode",
      label: "OpenCode Config",
      files: opencodeFiles,
      exists: opencodeFiles.length > 0,
      isDir: false,
    },
    {
      key: "journal",
      label: "Journal Entries",
      files: [{ original: journalDir }],
      exists: fs.existsSync(journalDir) && fs.readdirSync(journalDir).length > 0,
      isDir: true,
    },
  ];
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function mkdirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function copyFile(src: string, dest: string): Promise<number> {
  await Bun.write(dest, Bun.file(src));
  const stat = fs.statSync(dest);
  return stat.size;
}

async function copyDir(src: string, dest: string): Promise<number> {
  let totalSize = 0;
  mkdirSync(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      totalSize += await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      totalSize += await copyFile(srcPath, destPath);
    }
  }
  return totalSize;
}

export async function createBackup(
  sourceKeys: string[],
  label?: string,
): Promise<{ name: string; date: string; label?: string; sources: string[]; error?: string }> {
  const allSources = getBackupSources();
  const selected = allSources.filter(s => sourceKeys.includes(s.key));

  if (selected.length === 0) {
    return { name: "", date: "", sources: [], error: "No valid sources selected" };
  }

  const backupDir = getBackupDir();
  mkdirSync(backupDir);

  const now = new Date();
  let name = now.toISOString().replace(/[-:]/g, "").replace(/[.].+/, "");
  let dir = path.join(backupDir, name);
  let suffix = 1;
  while (fs.existsSync(dir)) {
    name = now.toISOString().replace(/[-:]/g, "").replace(/[.].+/, "") + `-${suffix}`;
    dir = path.join(backupDir, name);
    suffix++;
  }
  const date = now.toISOString();
  mkdirSync(dir);

  const manifest: BackupManifest = {
    name,
    date,
    label,
    sources: {},
    totalSize: 0,
  };

  for (const src of selected) {
    const srcDir = path.join(dir, src.key);
    mkdirSync(srcDir);

    let totalSize = 0;
    const storedFiles: Array<{ original: string; stored: string; size: number; }> = [];

      if (src.isDir && src.files.length > 0) {
        const srcPath = src.files[0]!.original;
      if (fs.existsSync(srcPath)) {
        totalSize += await copyDir(srcPath, srcDir);
        storedFiles.push({ original: srcPath, stored: src.key, size: totalSize });
      }
    } else {
      for (const file of src.files) {
        if (fs.existsSync(file.original)) {
          const basename = path.basename(file.original);
          if (src.files.length === 1) {
            const dest = path.join(srcDir, basename);
            const size = await copyFile(file.original, dest);
            storedFiles.push({ original: file.original, stored: path.join(src.key, basename), size });
            totalSize += size;
          } else {
            const dest = path.join(srcDir, basename);
            const size = await copyFile(file.original, dest);
            storedFiles.push({ original: file.original, stored: path.join(src.key, basename), size });
            totalSize += size;
          }
        }
      }
    }

    manifest.sources[src.key] = {
      label: src.label,
      files: storedFiles,
      totalSize,
    };
    manifest.totalSize += totalSize;
  }

  // Write manifest
  const manifestPath = path.join(dir, "manifest.json");
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

  memLog("info", "backup", `Backup created: ${name}`, {
    sources: sourceKeys,
    totalSize: manifest.totalSize,
  });

  return { name, date, label, sources: sourceKeys };
}

export async function listBackups(): Promise<BackupEntry[]> {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return [];

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  const results: BackupEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("pre-restore-")) continue;

    const manifestPath = path.join(backupDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest: BackupManifest = JSON.parse(raw);

      const sources: Record<string, { label: string; fileCount: number; totalSize: number }> = {};
      for (const [key, val] of Object.entries(manifest.sources)) {
        sources[key] = {
          label: val.label,
          fileCount: val.files.length,
          totalSize: val.totalSize,
        };
      }

      results.push({
        name: manifest.name,
        date: manifest.date,
        label: manifest.label,
        totalSize: manifest.totalSize,
        sources,
      });
    } catch {
      // Skip malformed manifests
      continue;
    }
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  return results;
}

export async function deleteBackup(name: string): Promise<{ success: boolean; error?: string }> {
  const dir = path.join(getBackupDir(), name);
  if (!fs.existsSync(dir)) {
    return { success: false, error: "Backup not found" };
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    memLog("info", "backup", `Backup deleted: ${name}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function restoreBackup(
  backupName: string,
  sourceKeys: string[],
): Promise<{ success: boolean; preRestoreBackup?: string; error?: string }> {
  const backupDir = path.join(getBackupDir(), backupName);
  const manifestPath = path.join(backupDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return { success: false, error: "Backup not found or manifest missing" };
  }

  let manifest: BackupManifest;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    manifest = JSON.parse(raw);
  } catch {
    return { success: false, error: "Invalid manifest" };
  }

  // Validate all requested sources exist in backup
  for (const key of sourceKeys) {
    if (!manifest.sources[key]) {
      return { success: false, error: `Source "${key}" not found in backup` };
    }
  }

  // Create pre-restore backup
  const preBackup = await createBackup(sourceKeys, `pre-restore-${backupName}`);
  if (preBackup.error) {
    return { success: false, error: `Failed to create pre-restore backup: ${preBackup.error}` };
  }

  // Restore each source
  for (const key of sourceKeys) {
    const src = manifest.sources[key]!;
    for (const file of src.files) {
      const storedPath = path.join(backupDir, file.stored);
      const originalDir = path.dirname(file.original);
      mkdirSync(originalDir);
      await copyFile(storedPath, file.original);
    }
  }

  memLog("info", "backup", `Restored from ${backupName}`, { sources: sourceKeys });

  return { success: true, preRestoreBackup: preBackup.name };
}
