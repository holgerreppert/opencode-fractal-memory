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

function readTuiJson(file: string): TuiJson {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf-8")) as TuiJson;
  } catch {
    return {};
  }
}

/**
 * Idempotently register `pkgName` (npm spec) in a tui.json `plugin` array.
 * Merge-preserving: other plugins' entries stay untouched. Legacy absolute
 * `dist/tui.js` entries for this plugin are dropped (they caused duplicate
 * boxes — npm vs file specs are not deduped by OpenCode).
 *
 * Both the V1 `plugin` key and the V2 `plugins` key are written so the same
 * file registers the plugin on either runtime.
 */
export function registerTuiEntry(file: string, pkgName: string): boolean {
  const json = readTuiJson(file);
  // OpenCode 2.x has a single `plugins` key, so it must carry every entry the
  // V1 `plugin` key holds. Union both, then drop this package's legacy
  // absolute `dist/tui.js` entries (they caused duplicate sidebar boxes
  // because npm specs and file paths are not deduped by OpenCode). Other
  // packages' entries are left untouched.
  const others: string[] = [];
  for (const list of [json.plugin ?? [], json.plugins ?? []]) {
    for (const p of list) {
      if (p.includes(pkgName) && p.includes(LEGACY_ENTRY_MARKER)) continue;
      if (p === pkgName) continue;
      if (!others.includes(p)) others.push(p);
    }
  }
  const changed = !(json.plugin ?? []).includes(pkgName) || !(json.plugins ?? []).includes(pkgName);
  if (!changed) return false;
  const next: TuiJson = { ...json };
  if (!next.$schema) {
    next.$schema = path.basename(file) === "cli.json" ? "https://opencode.ai/cli.json" : "https://opencode.ai/tui.json";
  }
  next.plugin = [pkgName, ...others];
  next.plugins = [pkgName, ...others];
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
 * Registers in both `tui.json` (OpenCode 1.x terminal client) and `cli.json`
 * (OpenCode 2.x terminal client) so the sidebar works on either runtime.
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
    try {
      if (registerTuiEntry(result.cliJsonPath, pkgName)) result.registered = true;
    } catch (err) {
      memLog("warn", "init", "[tui-self-register] cli.json registration failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
