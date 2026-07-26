import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { memLog } from "../logging";

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
}

function getDbPath(): string {
  return path.join(os.homedir(), ".config", "opencode", "memory.db");
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
  const dbPath = getDbPath();
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
  label?: string | undefined;
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
  label?: string | undefined;
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

export function getProjectName(): string {
  return process.env.MGMT_PROJECT_NAME || path.basename(getProjectDir());
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
  const content = fs.readFileSync(src);
  fs.writeFileSync(dest, content);
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
): Promise<{ name: string; date: string; label?: string | undefined; sources: string[]; error?: string | undefined }> {
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
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

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
