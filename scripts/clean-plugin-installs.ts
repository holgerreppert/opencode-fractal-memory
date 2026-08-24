#!/usr/bin/env bun
/**
 * clean-plugin-installs.ts — remove every on-disk copy of opencode-fractal-memory
 * so a fresh install can be tested end-to-end (npm resolution, tui.json discovery, hooks).
 *
 * Locations cleaned:
 *  1. ~/.config/opencode/node_modules/opencode-fractal-memory   (legacy npm install — never read by OpenCode but touched by `npm i`)
 *  2. ~/.cache/opencode/packages/opencode-fractal-memory@latest (the ONLY path OpenCode loads — beacon-proven)
 *  3. ~/.cache/opencode/packages/opencode-fractal-memory/       (npm-style package dir with node_modules/)
 *  4. <project>/.opencode/node_modules/opencode-fractal-memory  (per-project installs; cwd + --project args)
 *  5. ~/.config/opencode/package.json dependency entry          (file: tarball pin from old manual installs)
 *
 * Usage:
 *   bun run plugin:clean            # delete all of the above
 *   bun run plugin:clean --dry-run  # show what would be deleted
 *   bun run plugin:clean --project /path/to/other/repo   # add another project to clean
 */
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PKG = "opencode-fractal-memory";
const dryRun = process.argv.includes("--dry-run");

const projectArgs: string[] = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--project") projectArgs.push(resolve(process.argv[i + 1] ?? ""));
}
const projects = [process.cwd(), ...projectArgs];

const home = homedir();
const targets: string[] = [
  join(home, ".config", "opencode", "node_modules", PKG),
  join(home, ".cache", "opencode", "packages", `${PKG}@latest`),
  join(home, ".cache", "opencode", "packages", PKG),
];
for (const p of projects) {
  if (!p || !existsSync(p)) continue;
  targets.push(join(p, ".opencode", "node_modules", PKG));
}

const globalPkgJson = join(home, ".config", "opencode", "package.json");

function rmrf(path: string): void {
  if (!existsSync(path)) return;
  const size = (() => {
    try { return statSync(path).isDirectory() ? "dir" : `${statSync(path).size}B`; } catch { return "?"; }
  })();
  if (dryRun) {
    console.log(`[dry-run] would delete ${size.padEnd(6)} ${path}`);
    return;
  }
  Bun.spawnSync(["rm", "-rf", path], { stdout: "inherit", stderr: "inherit" });
  console.log(`deleted   ${size.padEnd(6)} ${path}`);
}

console.log(`clean-plugin-installs${dryRun ? " (--dry-run)" : ""}\n`);
for (const t of targets) rmrf(t);

// Drop the stale file: dependency pin so a fresh `npm i`/opencode install resolves the registry.
if (existsSync(globalPkgJson)) {
  const raw = readFileSync(globalPkgJson, "utf8");
  try {
    const json = JSON.parse(raw) as { dependencies?: Record<string, string> };
    if (json.dependencies && PKG in json.dependencies) {
      const pinned = json.dependencies[PKG];
      if (dryRun) {
        console.log(`[dry-run] would remove "${PKG}": "${pinned}" from ${globalPkgJson}`);
      } else {
        delete json.dependencies[PKG];
        writeFileSync(globalPkgJson, JSON.stringify(json, null, 2) + "\n");
        console.log(`removed   dep "${PKG}": "${pinned}" from ${globalPkgJson}`);
      }
    }
  } catch { /* unparseable package.json — leave it alone */ }
}

if (!dryRun) {
  console.log(`
All copies removed. Next steps for a clean-install test:
  1. (optional) publish first: npm version patch && npm publish   — published 0.8.2 predates tui.json!
  2. start opencode in a project whose opencode.json lists "opencode-fractal-memory"
     → OpenCode auto-resolves/installs into .opencode/node_modules or the cache.
  3. verify: grep PLUGIN_LOADED_FROM ~/.config/opencode/logs/memory-plugin.log
     and check the Fractal Memory sidebar box renders.`);
}
