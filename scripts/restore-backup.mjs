#!/usr/bin/env node
// Standalone cross-machine backup restore.
//
// A backup created by the plugin's management app is a directory:
//   ~/.config/opencode/backups/<name>/
//     manifest.json
//     config/<contents of ~/.config/opencode>      (whole dir)
//     cache/<contents of ~/.cache/opencode>        (whole dir)
//     opencode-home/<contents of ~/.opencode>      (whole dir)
//
// This script restores any subset of those sources onto the *local* machine
// by copying each snapshot dir over its target dir. No plugin install, no
// ~/.config reads required beyond the standard homedir layout.
//
// Usage:
//   node scripts/restore-backup.mjs list                     # list available backups
//   node scripts/restore-backup.mjs <backupName> --sources all
//   node scripts/restore-backup.mjs <backupName> --sources config,cache
//   node scripts/restore-backup.mjs <backupName> --sources config --dry-run
//   node scripts/restore-backup.mjs <backupName> --sources all --no-snapshot
//
// Options:
//   --sources <list>   comma-separated source keys, or "all" (default: all)
//   --backups-dir <p>  backup root (default: ~/.config/opencode/backups)
//   --dry-run          show what would be restored, change nothing
//   --no-snapshot      skip the automatic pre-restore snapshot of current state
//   -h, --help         help

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const args = process.argv.slice(2);

function getFlag(name) {
  return args.includes(name);
}
function getOpt(name) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
}

function usage() {
  const lines = fs.readFileSync(new URL(import.meta.url), "utf-8").split("\n").slice(2, 15);
  console.log(lines.join("\n"));
  process.exit(0);
}

if (getFlag("-h") || getFlag("--help")) usage();

const HOME = os.homedir();
const DEFAULT_BACKUPS_DIR = path.join(HOME, ".config", "opencode", "backups");

function resolveBackupsDir() {
  const p = getOpt("--backups-dir");
  return p ? path.resolve(p) : DEFAULT_BACKUPS_DIR;
}

function homeDirs() {
  return {
    config: path.join(HOME, ".config", "opencode"),
    cache: path.join(HOME, ".cache", "opencode"),
    "opencode-home": path.join(HOME, ".opencode"),
  };
}

function listBackups(backupsDir) {
  if (!fs.existsSync(backupsDir)) {
    console.error(`No backups directory at ${backupsDir}`);
    process.exit(1);
  }
  const out = [];
  for (const entry of fs.readdirSync(backupsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifestPath = path.join(backupsDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      out.push({ name: m.name, date: m.date, label: m.label, sources: Object.keys(m.sources), totalSize: m.totalSize });
    } catch {
      // skip malformed
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

function fmtSize(bytes) {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function main() {
  const backupsDir = resolveBackupsDir();

  if (args[0] === "list" || args.length === 0) {
    const backups = listBackups(backupsDir);
    if (backups.length === 0) {
      console.log(`No backups found in ${backupsDir}`);
      return;
    }
    console.log(`Backups in ${backupsDir}:\n`);
    for (const b of backups) {
      console.log(`  ${b.name}  ${b.date}  [${b.sources.join(", ")}]  ${fmtSize(b.totalSize)}`);
      if (b.label) console.log(`      label: ${b.label}`);
    }
    return;
  }

  const backupName = args[0];
  const backupDir = path.join(backupsDir, backupName);
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`Backup not found: ${backupDir}`);
    console.error(`Run "node ${process.argv[1]} list" to see available backups.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const sourcesArg = getOpt("--sources") || "all";
  const allKeys = Object.keys(manifest.sources);
  const selected = sourcesArg === "all" ? allKeys : sourcesArg.split(",").map((s) => s.trim()).filter(Boolean);
  const missing = selected.filter((k) => !allKeys.includes(k));
  if (missing.length) {
    console.error(`Unknown source(s): ${missing.join(", ")}. Available: ${allKeys.join(", ")}`);
    process.exit(1);
  }

  const targets = homeDirs();
  const dryRun = getFlag("--dry-run");
  const snapshot = !getFlag("--no-snapshot");

  console.log(`Backup: ${manifest.name}  (${manifest.date})`);
  if (manifest.label) console.log(`Label:  ${manifest.label}`);
  console.log(`Sources: ${selected.join(", ")}`);
  console.log(`Dry-run: ${dryRun}\n`);

  for (const key of selected) {
    const src = manifest.sources[key];
    const snapshotDir = path.join(backupDir, key);
    const target = targets[key] || src.files[0]?.original;
    const exists = fs.existsSync(snapshotDir);
    console.log(`  ${key}`);
    console.log(`    snapshot : ${snapshotDir} ${exists ? "" : "(MISSING)"}`);
    console.log(`    target   : ${target}`);
    if (!exists) continue;
    let fileCount = 0, size = 0;
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else { fileCount++; size += fs.statSync(p).size; }
      }
    })(snapshotDir);
    console.log(`    restore  : ${fileCount} files, ${fmtSize(size)}${dryRun ? " (dry-run, no changes)" : ""}`);
  }

  if (dryRun) {
    console.log("\nDry-run complete. No changes made.");
    return;
  }

  // Pre-restore snapshot of current state (skip source dirs if absent)
  if (snapshot) {
    const snapDir = path.join(os.tmpdir(), `opencode-pre-restore-${Date.now()}`);
    fs.mkdirSync(snapDir, { recursive: true });
    const manifestOut = { name: `pre-restore-${backupName}`, date: new Date().toISOString(), sources: {} };
    for (const key of selected) {
      const target = targets[key];
      if (!fs.existsSync(target)) continue;
      const dest = path.join(snapDir, key);
      copyDir(target, dest);
      manifestOut.sources[key] = { original: target, stored: key, isDir: true };
    }
    fs.writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify(manifestOut, null, 2));
    console.log(`\nPre-restore snapshot saved to: ${snapDir}`);
  }

  console.log("");
  for (const key of selected) {
    const snapshotDir = path.join(backupDir, key);
    const target = targets[key];
    if (!fs.existsSync(snapshotDir)) {
      console.error(`  ${key}: snapshot missing, skipped`);
      continue;
    }
    fs.mkdirSync(target, { recursive: true });
    copyDir(snapshotDir, target);
    console.log(`  ${key}: restored → ${target}`);
  }

  console.log("\nRestore complete. Restart OpenCode to pick up restored state.");
}

main();
