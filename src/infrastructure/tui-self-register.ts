import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { memLog } from "../logging";

interface TuiJson {
  $schema?: string;
  plugin?: string[];
  /** OpenCode 2.x renamed the `plugin` key to `plugins`. */
  plugins?: string[];
}

const LEGACY_ENTRY_MARKER = "dist/tui.js";

function globalTuiJsonPath(): string {
  return path.join(homedir(), ".config", "opencode", "tui.json");
}

/**
 * OpenCode 2.x moved terminal client configuration from the layered
 * `tui.json(c)` files to a single global `cli.json`.
 */
function globalCliJsonPath(): string {
  return path.join(homedir(), ".config", "opencode", "cli.json");
}

/**
 * OpenCode 2.x server-plugin configuration lives in `opencode.json` under the
 * renamed `plugins` key (V1 used `plugin`).
 */
function globalOpencodeJsonPath(): string {
  return path.join(homedir(), ".config", "opencode", "opencode.json");
}

function readTuiJson(file: string): TuiJson {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf-8")) as TuiJson;
  } catch {
    return {};
  }
}

/**
 * Register a V2 plugin entry in the `plugins` key of a config file.
 *
 * V2 accepts a package spec, a relative/absolute directory path, or a
 * `file://` URL. A local directory path is used for the dev flow: V2 then
 * loads the built plugin directly instead of running a package-manager
 * install, which keeps the dev loop fast and avoids registry resolution.
 *
 * V2 prefers the `plugins` key over the V1 `plugin` key for the same
 * canonical field, so the V1 entries are carried over — otherwise adding
 * `plugins` would silently drop plugins registered under `plugin`.
 *
 * Merge-preserving and idempotent: other plugins' entries are preserved and
 * the entry is never duplicated.
 */
export function registerV2PluginEntry(
  file: string,
  spec: string,
  options?: { exclude?: string[]; dropV1Key?: boolean },
): boolean {
  const json = readTuiJson(file);
  const exclude = options?.exclude ?? [];
  const kept = (list: string[]): string[] => list.filter((p) => !exclude.includes(p));
  const legacy = options?.dropV1Key ? [] : kept(json.plugin ?? []);
  const current = kept(json.plugins ?? []);
  const desired: string[] = [];
  for (const p of [spec, ...current, ...legacy]) {
    if (!desired.includes(p)) desired.push(p);
  }
  const v1KeyNeedsRemoval = Boolean(options?.dropV1Key) && Boolean(json.plugin);
  const unchanged =
    !v1KeyNeedsRemoval &&
    desired.length === (json.plugins ?? []).length &&
    desired.every((p, i) => p === (json.plugins ?? [])[i]);
  if (unchanged) return false;
  const next: TuiJson = { ...json };
  next.plugins = desired;
  if (options?.dropV1Key) delete next.plugin;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(tmpdir(), `.pluginjson-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  rmSync(tmp, { force: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

/**
 * Register this package's own directory as a V2 plugin in the global
 * `opencode.json` (server) and `cli.json` (terminal client).
 *
 * V2 resolves the package's `.` and `./tui` exports from the given
 * directory, so the built plugin is used as-is — no package-manager install
 * and no registry lookup.
 */
export function registerV2LocalPlugin(
  pkgRoot: string,
  pkgName: string,
  options?: { projectConfig?: string },
): { opencode: boolean; cli: boolean; project: boolean } {
  const result = { opencode: false, cli: false, project: false };
  try {
    // The npm spec is excluded: on V2 it would trigger a package-manager
    // install of the published (V1-shaped) package.
    result.opencode = registerV2PluginEntry(globalOpencodeJsonPath(), pkgRoot, { exclude: [pkgName] });
    result.cli = registerV2PluginEntry(globalCliJsonPath(), pkgRoot, {
      exclude: [pkgName],
      dropV1Key: true,
    });
    if (options?.projectConfig) {
      result.project = registerV2PluginEntry(options.projectConfig, pkgRoot, { exclude: [pkgName] });
    }
  } catch (err) {
    memLog("warn", "init", "[v2-self-register] failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}

/**
 * Idempotently register `pkgName` (npm spec) in a tui.json `plugin` array.
 * Merge-preserving: other plugins' entries stay untouched. Legacy absolute
 * `dist/tui.js` entries for this plugin are dropped (they caused duplicate
 * boxes — npm vs file specs are not deduped by OpenCode).
 *
 * This is the V1 (opencode 1.x) terminal-client key. V2 uses the `plugins`
 * key instead — see `registerV2PluginEntry`.
 */
export function registerTuiEntry(file: string, pkgName: string): boolean {
  const json = readTuiJson(file);
  const existing = json.plugin ?? [];
  // Keep the exact npm spec; drop only legacy absolute dist/tui.js variants of this package
  const cleaned = existing.filter((p) => !(p.includes(pkgName) && p.includes(LEGACY_ENTRY_MARKER)));
  const changed = cleaned.length !== existing.length || !cleaned.includes(pkgName);
  if (!changed) return false;
  const next: TuiJson = { ...json };
  if (!next.$schema) {
    next.$schema = path.basename(file) === "cli.json" ? "https://opencode.ai/cli.json" : "https://opencode.ai/tui.json";
  }
  next.plugin = [pkgName, ...cleaned.filter((p) => p !== pkgName)];
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(tmpdir(), `.tuijson-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  rmSync(tmp, { force: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

function insideOpenCodeDirs(pkgRoot: string): boolean {
  const normalized = path.resolve(pkgRoot);
  const cacheDir = path.join(homedir(), ".cache", "opencode");
  const configDir = path.join(homedir(), ".config", "opencode");
  return normalized.startsWith(cacheDir + path.sep) || normalized.startsWith(configDir + path.sep);
}

/**
 * Make the npm spec `pkgName` resolvable from `~/.config/opencode/node_modules`
 * by symlinking the package root — only when the package itself lives inside
 * OpenCode's cache/config dirs (registry or dev-cache installs). Dev repo
 * checkouts are handled by scripts/dev-install.ts instead.
 */
export function ensureNodeModulesLink(pkgRoot: string, pkgName: string): boolean {
  try {
    if (!insideOpenCodeDirs(pkgRoot)) return false;
    const linkDir = path.join(homedir(), ".config", "opencode", "node_modules");
    const link = path.join(linkDir, pkgName);
    const target = path.resolve(pkgRoot);
    if (existsSync(link)) {
      let real = link;
      try {
        real = realpathSync(link);
      } catch { /* broken symlink — recreate below */ }
      if (real === target) return false;
      rmSync(link, { recursive: true, force: true });
    }
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(target, link, "dir");
    return true;
  } catch {
    return false;
  }
}

export interface TuiSelfRegisterResult {
  registered: boolean;
  linked: boolean;
  tuiJsonPath: string;
  cliJsonPath: string;
}

/**
 * Server-side self-heal: make sure this plugin's TUI entry survives fresh
 * installs where lifecycle scripts never ran (OpenCode installs packages with
 * --ignore-scripts). Called from plugin init; never throws.
 *
 * Registers the V1 npm spec in `tui.json` (opencode 1.x terminal client) and
 * this package's own directory in `cli.json` / `opencode.json` under the V2
 * `plugins` key (opencode 2.x). A local directory lets V2 load the built
 * plugin directly instead of running a package-manager install.
 */
export function selfRegisterTui(pkgRoot: string, pkgName: string): TuiSelfRegisterResult {
  const result: TuiSelfRegisterResult = {
    registered: false,
    linked: false,
    tuiJsonPath: globalTuiJsonPath(),
    cliJsonPath: globalCliJsonPath(),
  };
  try {
    result.registered = registerTuiEntry(result.tuiJsonPath, pkgName);
    const v2 = registerV2LocalPlugin(pkgRoot, pkgName);
    if (v2.opencode || v2.cli) result.registered = true;
    result.linked = ensureNodeModulesLink(pkgRoot, pkgName);
    if (result.registered || result.linked) {
      memLog("info", "init", "[tui-self-register] ensured TUI registration", {
        tuiJson: result.tuiJsonPath,
        cliJson: result.cliJsonPath,
        registered: result.registered,
        linked: result.linked,
        pkgName,
      });
    }
  } catch (err) {
    memLog("warn", "init", "[tui-self-register] failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}
