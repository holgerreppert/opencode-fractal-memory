import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { memLog } from "../logging";

interface TuiJson {
  $schema?: string;
  plugin?: string[];
}

const LEGACY_ENTRY_MARKER = "dist/tui.js";

function globalTuiJsonPath(): string {
  return path.join(homedir(), ".config", "opencode", "tui.json");
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
 */
export function registerTuiEntry(file: string, pkgName: string): boolean {
  const json = readTuiJson(file);
  const existing = json.plugin ?? [];
  // Keep the exact npm spec; drop only legacy absolute dist/tui.js variants of this package
  const cleaned = existing.filter((p) => !(p.includes(pkgName) && p.includes(LEGACY_ENTRY_MARKER)));
  const changed = cleaned.length !== existing.length || !cleaned.includes(pkgName);
  if (!changed) return false;
  const next: TuiJson = { ...json };
  if (!next.$schema) next.$schema = "https://opencode.ai/tui.json";
  next.plugin = [pkgName, ...cleaned];
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
}

/**
 * Server-side self-heal: make sure this plugin's TUI entry survives fresh
 * installs where lifecycle scripts never ran (OpenCode installs packages with
 * --ignore-scripts). Called from plugin init; never throws.
 */
export function selfRegisterTui(pkgRoot: string, pkgName: string): TuiSelfRegisterResult {
  const result: TuiSelfRegisterResult = { registered: false, linked: false, tuiJsonPath: globalTuiJsonPath() };
  try {
    result.registered = registerTuiEntry(result.tuiJsonPath, pkgName);
    result.linked = ensureNodeModulesLink(pkgRoot, pkgName);
    if (result.registered || result.linked) {
      memLog("info", "init", "[tui-self-register] ensured TUI registration", {
        tuiJson: result.tuiJsonPath,
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
