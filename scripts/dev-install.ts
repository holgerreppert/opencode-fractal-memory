#!/usr/bin/env bun
/**
 * Dev install: build + clean + sync the plugin into the OpenCode load location.
 *
 * OpenCode loads the plugin ONLY from the plugin cache @latest path
 * (NOT ~/.config/opencode/node_modules — that copy is legacy and never read).
 * Beacon-proven: the PLUGIN_LOADED_FROM startup log in
 * ~/.config/opencode/logs/memory-plugin.log shows the resolvedDir always points
 * at ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/...
 * This script:
 *
 *   1. builds the project (unless --skip-build)
 *   2. wipes the plugin package dir in the cache @latest path:
 *        - ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory
 *      (the legacy ~/.config/opencode/node_modules/opencode-fractal-memory copy is
 *       also cleaned/synced for npm-pack compatibility — OpenCode never reads it)
 *   3. copies ALL top-level files (dist, frontend, package.json, LICENSE, README.md,
 *      commands, agent, scripts) into the cache location
 *   4. copies the runtime deps the plugin needs into the cache location's own node_modules
 *      (graphology family, tree-sitter wasm, onnxruntime, ...)
 *   5. prints the installed version + RESTART REQUIRED warning
 *   6. fails with a non-zero exit if `dist` is missing from the cache
 *
 * Verify after restart: grep "PLUGIN_LOADED_FROM" ~/.config/opencode/logs/memory-plugin.log
 * — resolvedDir must point at the cache @latest path.
 *
 * Usage:
 *   bun run scripts/dev-install.ts          # build + install
 *   bun run scripts/dev-install.ts --skip-build   # install only (dist already fresh)
 */
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { registerPluginEntry } from "../src/infrastructure/plugin-registration";

const HOME = homedir();
const REPO_ROOT = path.resolve(import.meta.dir, "..");

const PLUGIN_NAME = "opencode-fractal-memory";

/** Both install locations. Order matters: cache is last so final verification reads it. */
const TARGETS = [
  path.join(HOME, ".config", "opencode", "node_modules", PLUGIN_NAME),
  path.join(HOME, ".cache", "opencode", "packages", "opencode-fractal-memory@latest", "node_modules", PLUGIN_NAME),
];

/** Top-level files/dirs copied verbatim from the repo into each location. */
const TOP_LEVEL_ITEMS = [
  "dist",
  "index.js",
  "tui.js",
  "frontend",
  "package.json",
  "LICENSE",
  "README.md",
  "commands",
  "agent",
  "scripts",
];

/**
 * Runtime deps that must exist in the plugin's OWN node_modules so bun resolves them
 * when the plugin is loaded from the cache dir (the cache's parent node_modules does
 * not contain the graphology family / tree-sitter wasm / onnxruntime).
 */
const NESTED_DEPS = [
  "events",
  "graphology",
  "graphology-communities-louvain",
  "graphology-indices",
  "graphology-shortest-path",
  "graphology-traversal",
  "graphology-utils",
  "pandemonium",
  "mnemonist",
  "obliterator",
  "onnxruntime-node",
  "onnxruntime-web",
  "@kreuzberg/tree-sitter-language-pack-wasm",
  "@yomguithereal/helpers",
  "@opentui/core",
  "@opentui/solid",
  "solid-js",
  "entities",
  "sqlite-vec",
  "sqlite-vec-linux-x64",
  "sqlite-vec-darwin-x64",
  "sqlite-vec-darwin-arm64",
  "sqlite-vec-linux-arm64",
  "sqlite-vec-windows-x64",
];

const SKIP_BUILD = process.argv.includes("--skip-build");

function log(msg: string): void {
  console.log(`[dev-install] ${msg}`);
}

/**
 * Prepare an install target WITHOUT removing its contents.
 *
 * The target may be the directory the running OpenCode process is loading the
 * plugin from. Deleting the files makes the in-flight import fail with
 * ENOENT, which makes OpenCode reload the plugin and restart the service —
 * and that in turn re-triggers the install, i.e. a restart loop. Overwriting
 * in place (atomically, per file) keeps the plugin loadable throughout.
 */
async function cleanTarget(target: string): Promise<void> {
  log(`Preparing ${target}`);
  await mkdir(target, { recursive: true });
}

/**
 * Copy `src` over `dest` without ever removing a file that is already there.
 *
 * Each file is copied to a temp name and renamed over the target, so a
 * concurrent import always finds a complete file — the plugin never fails to
 * load with ENOENT mid-install.
 */
async function copyAtomic(
  src: string,
  dest: string,
  options?: { filter?: (from: string) => boolean },
): Promise<void> {
  const info = await stat(src);
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true });
    for (const entry of await readdir(src)) {
      if (options?.filter && !options.filter(path.join(src, entry))) continue;
      await copyAtomic(path.join(src, entry), path.join(dest, entry), options);
    }
    return;
  }
  const tmp = `${dest}.tmp-${process.pid}`;
  await rm(tmp, { force: true });
  await cp(src, tmp, { force: true });
  await rename(tmp, dest);
}

async function copyTopLevel(target: string): Promise<void> {
  for (const item of TOP_LEVEL_ITEMS) {
    const src = path.join(REPO_ROOT, item);
    if (!existsSync(src)) {
      log(`  WARN: missing ${item} in repo — skipping`);
      continue;
    }
    // Skip nested tooling dirs (frontend/node_modules is ~287MB; only frontend/build is served)
    const filter = (from: string): boolean =>
      !/(^|[\\/])(node_modules|\.svelte-kit)([\\/]|$)/.test(from);
    await copyAtomic(src, path.join(target, item), { filter });
  }
}

async function copyNestedDeps(target: string): Promise<void> {
  const destRoot = path.join(target, "node_modules");
  await mkdir(destRoot, { recursive: true });
  for (const dep of NESTED_DEPS) {
    const src = path.join(REPO_ROOT, "node_modules", dep);
    if (!existsSync(src)) {
      log(`  WARN: missing dep ${dep} in repo node_modules — skipping`);
      continue;
    }
    await copyAtomic(src, path.join(destRoot, dep));
  }
}

/**
 * A `plugins` entry that belongs to this package but is NOT the repo path.
 *
 * Stale shapes from earlier installs: the bare npm spec (triggers a
 * package-manager install), package-cache paths, shim directories under
 * `~/.config/opencode/plugins/`, and absolute `dist/*.js` paths. All of them
 * survive config edits and turn into "Plugin failed" popups.
 */
function isStaleFractalMemoryEntry(entry: string, repoRoot: string): boolean {
  if (entry === repoRoot) return false;
  // Bare npm spec, package-cache paths, shim dirs under
  // ~/.config/opencode/plugins/, and absolute dist/*.js paths all contain the
  // package name — none of them is the repo directory we want.
  return entry.includes(PLUGIN_NAME);
}

/**
 * Register the plugin exactly once, as the absolute repo directory.
 *
 * OpenCode 2.x `plugins` accepts absolute directory paths and resolves them
 * through the package's `exports` map — no package-manager install, no shim
 * directory, and the live `dist/` is used as-is. The same single entry goes
 * into `opencode.json` (server) and `cli.json` (terminal client).
 */
function ensureGlobalRegistration(): void {
  const globalDir = path.join(HOME, ".config", "opencode");
  const strip = (entry: string): boolean => isStaleFractalMemoryEntry(entry, REPO_ROOT);
  for (const name of ["opencode.json", "cli.json"]) {
    const file = path.join(globalDir, name);
    const changed = registerPluginEntry(file, REPO_ROOT, { strip });
    log(changed ? `Registered ${REPO_ROOT} in ${file}` : `Already registered in ${file}`);
  }
}

async function main(): Promise<void> {
  const { version } = JSON.parse(
    await (await import("node:fs/promises")).readFile(path.join(REPO_ROOT, "package.json"), "utf-8"),
  ) as { version: string };

  log(`Repo: ${REPO_ROOT} (v${version})`);
  if (!SKIP_BUILD) {
    log("Building (bun run build)...");
    execSync("bun run build", { cwd: REPO_ROOT, stdio: "inherit" });
  } else {
    log("Skipping build (--skip-build)");
  }

  for (const target of TARGETS) {
    log(`=== Syncing ${target} ===`);
    await cleanTarget(target);
    await copyTopLevel(target);
    await copyNestedDeps(target);
  }

  ensureGlobalRegistration();

  const cacheTarget = TARGETS[1];
  const cachePkg = path.join(cacheTarget, "package.json");
  const cacheVersion = existsSync(cachePkg)
    ? (JSON.parse(await (await import("node:fs/promises")).readFile(cachePkg, "utf-8")) as { version?: string }).version
    : "MISSING";
  const distOk = existsSync(path.join(cacheTarget, "dist"));

  console.log("");
  console.log("================================================================");
  console.log(`  Plugin v${version} installed. Cache copy reports v${cacheVersion}.`);
  console.log(`  dist present in cache: ${distOk ? "yes" : "NO — install FAILED"}`);
  console.log("");
  console.log("  RESTART REQUIRED — OpenCode loads the plugin from the cache dir");
  console.log("  at startup. The running process will NOT pick up these files.");
  console.log("");
  console.log("  Verify: grep -c captureSessionWork \\");
  console.log("    ~/.cache/opencode/packages/opencode-fractal-memory@latest/\\");
  console.log("    node_modules/opencode-fractal-memory/dist/application/work-capture.js");
  console.log("================================================================");
  if (!distOk) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[dev-install] FAILED:", err);
  process.exit(1);
});
