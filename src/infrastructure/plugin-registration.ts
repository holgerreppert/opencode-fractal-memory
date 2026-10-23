import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

interface PluginConfigJson {
  $schema?: string;
  /** Plugin list: package specs or absolute directory paths. */
  plugins?: string[];
}

function readPluginJson(file: string): PluginConfigJson {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf-8")) as PluginConfigJson;
  } catch {
    return {};
  }
}

/**
 * Register a plugin entry in the `plugins` key of a config file.
 *
 * The runtime accepts a package spec, a relative/absolute directory path, or a
 * `file://` URL. A local directory path is used for the dev flow: the runtime
 * then loads the built plugin directly instead of running a package-manager
 * install, which keeps the dev loop fast and avoids registry resolution.
 *
 * Merge-preserving and idempotent: other plugins' entries are preserved and
 * the entry is never duplicated.
 */
export function registerPluginEntry(
  file: string,
  spec: string,
  options?: { exclude?: string[] | undefined; strip?: ((entry: string) => boolean) | undefined },
): boolean {
  const json = readPluginJson(file);
  const exclude = options?.exclude ?? [];
  const strip = options?.strip;
  const current = (json.plugins ?? []).filter(
    (p) => !exclude.includes(p) && !(strip?.(p) ?? false),
  );
  const desired: string[] = [];
  for (const p of [spec, ...current]) {
    if (!desired.includes(p)) desired.push(p);
  }
  const unchanged =
    desired.length === (json.plugins ?? []).length &&
    desired.every((p, i) => p === (json.plugins ?? [])[i]);
  if (unchanged) return false;
  const next: PluginConfigJson = { $schema: json.$schema ?? schemaFor(file), plugins: desired };
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(tmpdir(), `.pluginjson-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  rmSync(tmp, { force: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

function schemaFor(file: string): string {
  return path.basename(file) === "cli.json" ? "https://opencode.ai/cli.json" : "https://opencode.ai/config.json";
}
