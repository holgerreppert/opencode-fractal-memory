import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const origConfigDir = process.env.MGMT_CONFIG_DIR;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  process.env.MGMT_CONFIG_DIR = tmpDir;
  process.env.MGMT_PROJECT_DIR = path.join(tmpDir, "project");
  fs.mkdirSync(path.join(tmpDir, "project"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "journal"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origConfigDir !== undefined) {
    process.env.MGMT_CONFIG_DIR = origConfigDir;
  } else {
    delete process.env.MGMT_CONFIG_DIR;
  }
  delete process.env.MGMT_PROJECT_DIR;
});

describe("getBackupDir", () => {
  test("returns path under config dir", () => {
    const { getBackupDir } = require("./helpers");
    expect(getBackupDir()).toBe(path.join(tmpDir, "backups"));
  });
});

describe("getConfigDir", () => {
  test("returns MGMT_CONFIG_DIR when set", () => {
    const { getConfigDir } = require("./helpers");
    expect(getConfigDir()).toBe(tmpDir);
  });
});

describe("getProjectDir", () => {
  test("returns MGMT_PROJECT_DIR when set", () => {
    const { getProjectDir } = require("./helpers");
    expect(getProjectDir()).toBe(path.join(tmpDir, "project"));
  });
});

describe("formatSize", () => {
  test("formats 0 bytes", () => {
    const { formatSize } = require("./helpers");
    expect(formatSize(0)).toBe("0 B");
  });

  test("formats bytes", () => {
    const { formatSize } = require("./helpers");
    expect(formatSize(500)).toBe("500 B");
  });

  test("formats kilobytes", () => {
    const { formatSize } = require("./helpers");
    expect(formatSize(2048)).toBe("2.0 KB");
  });

  test("formats megabytes", () => {
    const { formatSize } = require("./helpers");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  test("formats gigabytes", () => {
    const { formatSize } = require("./helpers");
    expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});

describe("getBackupSources", () => {
  test("returns sources with existence info", () => {
    const { getBackupSources } = require("./helpers");
    const sources = getBackupSources();
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const dbSource = sources.find(s => s.key === "db");
    expect(dbSource).toBeDefined();
    expect(dbSource!.exists).toBe(false);
    expect(dbSource!.label).toBe("Memory Database");
  });

  test("reports db as exists when memory.db is present", () => {
    fs.writeFileSync(path.join(tmpDir, "memory.db"), "fake");
    const { getBackupSources } = require("./helpers");
    const sources = getBackupSources();
    const dbSource = sources.find(s => s.key === "db");
    expect(dbSource!.exists).toBe(true);
  });
});

describe("createBackup", () => {
  test("returns error for empty source list", async () => {
    const { createBackup } = require("./helpers");
    const result = await createBackup([], "test-label");
    expect(result.error).toBe("No valid sources selected");
  });

  test("returns error for invalid source keys", async () => {
    const { createBackup } = require("./helpers");
    const result = await createBackup(["nonexistent"]);
    expect(result.error).toBe("No valid sources selected");
  });

  test("creates backup directory and manifest", async () => {
    fs.writeFileSync(path.join(tmpDir, "opencode-mem.json"), JSON.stringify({ test: true }));
    const { createBackup, getBackupDir } = require("./helpers");
    const result = await createBackup(["config"], "test-backup");
    expect(result.error).toBeUndefined();
    expect(result.name).toBeTruthy();
    expect(result.sources).toEqual(["config"]);
    expect(result.label).toBe("test-backup");

    const backupDir = getBackupDir();
    const backupPath = path.join(backupDir, result.name);
    expect(fs.existsSync(backupPath)).toBe(true);
    const manifestPath = path.join(backupPath, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.name).toBe(result.name);
    expect(manifest.label).toBe("test-backup");
    expect(manifest.sources.config).toBeDefined();
  });

  test("handles timestamp collision with suffix", async () => {
    fs.writeFileSync(path.join(tmpDir, "opencode-mem.json"), JSON.stringify({ test: true }));
    const { createBackup, getBackupDir } = require("./helpers");

    const result1 = await createBackup(["config"]);
    expect(result1.error).toBeUndefined();

    const backupDir = getBackupDir();
    const commonPrefix = result1.name.replace(/-\d+$/, "");

    // Manually create a collision dir
    const collisionDir = path.join(backupDir, `${commonPrefix}-1`);
    if (collisionDir !== path.join(backupDir, result1.name)) {
      fs.mkdirSync(collisionDir, { recursive: true });
    }

    const result2 = await createBackup(["config"]);
    expect(result2.error).toBeUndefined();
    expect(result2.name).not.toBe(result1.name);
    const result2Dir = path.join(backupDir, result2.name);
    expect(fs.existsSync(result2Dir)).toBe(true);
  });
});

describe("listBackups", () => {
  test("returns empty array when no backups exist", async () => {
    const { listBackups } = require("./helpers");
    const backups = await listBackups();
    expect(backups).toEqual([]);
  });

  test("lists created backups", async () => {
    fs.writeFileSync(path.join(tmpDir, "opencode-mem.json"), JSON.stringify({ test: true }));
    const { createBackup, listBackups } = require("./helpers");
    await createBackup(["config"], "list-test");
    const backups = await listBackups();
    expect(backups.length).toBe(1);
    expect(backups[0].label).toBe("list-test");
    expect(backups[0].sources.config).toBeDefined();
  });

  test("skips pre-restore backups", async () => {
    fs.writeFileSync(path.join(tmpDir, "opencode-mem.json"), JSON.stringify({ test: true }));
    const { createBackup, listBackups, getBackupDir } = require("./helpers");
    await createBackup(["config"]);
    const backupDir = getBackupDir();
    const entries = fs.readdirSync(backupDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("pre-restore-")) {
        fs.renameSync(
          path.join(backupDir, entry.name),
          path.join(backupDir, `pre-restore-${entry.name}`),
        );
        break;
      }
    }
    const backups = await listBackups();
    expect(backups.length).toBe(0);
  });
});

describe("deleteBackup", () => {
  test("returns error for non-existent backup", async () => {
    const { deleteBackup } = require("./helpers");
    const result = await deleteBackup("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Backup not found");
  });

  test("deletes existing backup", async () => {
    fs.writeFileSync(path.join(tmpDir, "opencode-mem.json"), JSON.stringify({ test: true }));
    const { createBackup, deleteBackup, getBackupDir } = require("./helpers");
    const created = await createBackup(["config"]);
    expect(created.error).toBeUndefined();

    const result = await deleteBackup(created.name);
    expect(result.success).toBe(true);

    const backupDir = getBackupDir();
    expect(fs.existsSync(path.join(backupDir, created.name))).toBe(false);
  });
});

describe("restoreBackup", () => {
  test("returns error for non-existent backup", async () => {
    const { restoreBackup } = require("./helpers");
    const result = await restoreBackup("nonexistent", ["config"]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/manifest missing/);
  });

  test("restores files back to original location", async () => {
    const configContent = JSON.stringify({ setting: "value" });
    const origConfigPath = path.join(tmpDir, "opencode-mem.json");
    fs.writeFileSync(origConfigPath, configContent);

    const { createBackup, restoreBackup, getBackupDir } = require("./helpers");
    const created = await createBackup(["config"], "restore-test");
    expect(created.error).toBeUndefined();

    // Wipe original and restore
    fs.unlinkSync(origConfigPath);
    expect(fs.existsSync(origConfigPath)).toBe(false);

    const result = await restoreBackup(created.name, ["config"]);
    expect(result.success).toBe(true);
    expect(result.preRestoreBackup).toBeTruthy();

    expect(fs.existsSync(origConfigPath)).toBe(true);
    const restored = JSON.parse(fs.readFileSync(origConfigPath, "utf-8"));
    expect(restored).toEqual({ setting: "value" });

    // Clean up pre-restore backup
    const backupDir = getBackupDir();
    if (result.preRestoreBackup) {
      fs.rmSync(path.join(backupDir, result.preRestoreBackup), { recursive: true, force: true });
    }
  });

  test("returns error when source not in backup", async () => {
    fs.writeFileSync(path.join(tmpDir, "opencode-mem.json"), JSON.stringify({ test: true }));
    const { createBackup, restoreBackup } = require("./helpers");
    const created = await createBackup(["config"]);
    expect(created.error).toBeUndefined();

    const result = await restoreBackup(created.name, ["db"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('"db" not found');
  });
});
