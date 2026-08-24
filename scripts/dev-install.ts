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
 *   3. copies ALL top-level files (dist, management, package.json, LICENSE, README.md,
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
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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
  "management",
  "package.json",
  "LICENSE",
  "README.md",
  "commands",
  "agent",
  "scripts",
  "tui.json",
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

async function cleanTarget(target: string): Promise<void> {
  log(`Cleaning ${target}`);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

async function copyTopLevel(target: string): Promise<void> {
  for (const item of TOP_LEVEL_ITEMS) {
    const src = path.join(REPO_ROOT, item);
    if (!existsSync(src)) {
      log(`  WARN: missing ${item} in repo — skipping`);
      continue;
    }
    await cp(src, path.join(target, item), { recursive: true });
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
    await cp(src, path.join(destRoot, dep), { recursive: true });
  }
}

/**
 * Register dist/tui.js in the GLOBAL tui.json (~/.config/opencode/tui.json).
 * OpenCode only scans project .opencode/tui.json + global config dir for TUI
 * manifests — a tui.json inside the installed package is never discovered.
 */
async function ensureGlobalTuiRegistration(): Promise<void> {
  const globalTui = path.join(homedir(), ".config", "opencode", "tui.json");
  const entry = path.join(TARGETS[1], "dist", "tui.js");
  if (!existsSync(entry)) {
    log(`WARN: ${entry} missing — cannot register TUI plugin`);
    return;
  }
  let json: { $schema?: string; plugin?: string[] } = {};
  try {
    if (existsSync(globalTui)) json = JSON.parse(await readFile(globalTui, "utf-8"));
  } catch { /* corrupt file — start fresh */ }
  const plugins = new Set(json.plugin ?? []);
  plugins.add(entry);
  json.$schema ??= "https://opencode.ai/tui.json";
  json.plugin = [...plugins];
  await writeFile(globalTui, `${JSON.stringify(json, null, 2)}\n`);
  log(`TUI registered in ${globalTui}`);
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

  await ensureGlobalTuiRegistration();

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
