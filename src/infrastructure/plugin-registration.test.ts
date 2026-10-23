import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerPluginEntry } from "../infrastructure/plugin-registration";

let dir: string;

describe("registerPluginEntry", () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pluginjson-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes only the V2 `plugins` key", () => {
    const file = path.join(dir, "cli.json");
    expect(registerPluginEntry(file, "/opt/plugin")).toBe(true);
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugin?: string[]; plugins?: string[] };
    expect(json.plugins).toEqual(["/opt/plugin"]);
    expect(json.plugin).toBeUndefined();
  });

  test("is idempotent", () => {
    const file = path.join(dir, "cli.json");
    registerPluginEntry(file, "/opt/plugin");
    const before = readFileSync(file, "utf-8");
    expect(registerPluginEntry(file, "/opt/plugin")).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("preserves other plugins' entries", () => {
    const file = path.join(dir, "cli.json");
    writeFileSync(file, JSON.stringify({ plugins: ["opencode-model-router"] }));
    registerPluginEntry(file, "/opt/plugin");
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugins?: string[] };
    expect(json.plugins).toEqual(["/opt/plugin", "opencode-model-router"]);
  });

  test("strips stale entries via the `strip` option", () => {
    const file = path.join(dir, "opencode.json");
    writeFileSync(
      file,
      JSON.stringify({
        plugins: [
          "/home/x/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory",
          "opencode-fractal-memory",
          "other-plugin",
        ],
      }),
    );
    registerPluginEntry(file, "/repo", { strip: (entry) => entry.includes("opencode-fractal-memory") });
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugins?: string[] };
    expect(json.plugins).toEqual(["/repo", "other-plugin"]);
  });

  test("keeps the schema and uses the cli.json schema", () => {
    const file = path.join(dir, "cli.json");
    registerPluginEntry(file, "/opt/plugin");
    const json = JSON.parse(readFileSync(file, "utf-8")) as { $schema?: string };
    expect(json.$schema).toBe("https://opencode.ai/cli.json");
  });

  test("recovers from corrupt json", () => {
    const file = path.join(dir, "cli.json");
    writeFileSync(file, "{not json");
    expect(registerPluginEntry(file, "/opt/plugin")).toBe(true);
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugins?: string[] };
    expect(json.plugins).toEqual(["/opt/plugin"]);
  });

  test("exclude drops a legacy entry from the same file", () => {
    const file = path.join(dir, "opencode.json");
    writeFileSync(file, JSON.stringify({ plugins: ["opencode-fractal-memory", "other-plugin"] }));
    registerPluginEntry(file, "/repo", { exclude: ["opencode-fractal-memory"] });
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugins?: string[] };
    expect(json.plugins).toEqual(["/repo", "other-plugin"]);
  });
});
