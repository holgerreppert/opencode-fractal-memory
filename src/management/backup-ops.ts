import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { memLog } from "../logging";

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

export function getProjectDir(): string {
  return process.env.MGMT_PROJECT_DIR || process.cwd();
}

export function getProjectName(): string {
  return process.env.MGMT_PROJECT_NAME || path.basename(getProjectDir());
}

export function getConfigDir(): string {
  return process.env.MGMT_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
}

export function getBackupDir(): string {
  return path.join(getConfigDir(), "backups");
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
          const dest = path.join(srcDir, basename);
          const size = await copyFile(file.original, dest);
          storedFiles.push({ original: file.original, stored: path.join(src.key, basename), size });
          totalSize += size;
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
