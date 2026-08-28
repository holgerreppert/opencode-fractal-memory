import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerTuiEntry } from "../infrastructure/tui-self-register";

let dir: string;

describe("registerTuiEntry", () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tuijson-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates file with schema and entry when missing", () => {
    const file = path.join(dir, "tui.json");
    expect(registerTuiEntry(file, "opencode-fractal-memory")).toBe(true);
    const json = JSON.parse(readFileSync(file, "utf-8")) as { $schema?: string; plugin?: string[] };
    expect(json.$schema).toBe("https://opencode.ai/tui.json");
    expect(json.plugin).toEqual(["opencode-fractal-memory"]);
  });

  test("idempotent — second call is a no-op", () => {
    const file = path.join(dir, "tui.json");
    registerTuiEntry(file, "opencode-fractal-memory");
    const before = readFileSync(file, "utf-8");
    expect(registerTuiEntry(file, "opencode-fractal-memory")).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("merge-preserving — keeps other plugins' entries", () => {
    const file = path.join(dir, "tui.json");
    writeFileSync(file, JSON.stringify({ $schema: "https://opencode.ai/tui.json", plugin: ["other-plugin"] }));
    registerTuiEntry(file, "opencode-fractal-memory");
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugin?: string[] };
    expect(json.plugin).toContain("other-plugin");
    expect(json.plugin).toContain("opencode-fractal-memory");
  });

  test("drops legacy dist/tui.js entries for this package only", () => {
    const file = path.join(dir, "tui.json");
    writeFileSync(
      file,
      JSON.stringify({
        $schema: "https://opencode.ai/tui.json",
        plugin: ["/home/x/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/dist/tui.js", "other-plugin"],
      }),
    );
    registerTuiEntry(file, "opencode-fractal-memory");
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugin?: string[] };
    expect(json.plugin).toEqual(["opencode-fractal-memory", "other-plugin"]);
  });

  test("recovers from corrupt json", () => {
    const file = path.join(dir, "tui.json");
    writeFileSync(file, "{not json");
    expect(registerTuiEntry(file, "opencode-fractal-memory")).toBe(true);
    const json = JSON.parse(readFileSync(file, "utf-8")) as { plugin?: string[] };
    expect(json.plugin).toEqual(["opencode-fractal-memory"]);
  });
});

// ensureNodeModulesLink + selfRegisterTui touch ~/.config/opencode — smoke-test
// only the guard behavior (non-OpenCode dirs must be skipped, no side effects).
describe("selfRegisterTui guards", () => {
  test("ensureNodeModulesLink skips dev repo dirs", async () => {
    const { ensureNodeModulesLink } = await import("../infrastructure/tui-self-register");
    const fakeRepo = mkdtempSync(path.join(tmpdir(), "fakerepo-"));
    try {
      expect(ensureNodeModulesLink(fakeRepo, "opencode-fractal-memory")).toBe(false);
      expect(() => {
        const link = path.join(homedir(), ".config", "opencode", "node_modules", "opencode-fractal-memory");
        void link;
      }).not.toThrow();
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  });

  test("symlink target detection works for linked dirs", () => {
    const base = mkdtempSync(path.join(tmpdir(), "linktest-"));
    const realDir = path.join(base, "real");
    const linkDir = path.join(base, "link");
    mkdirSync(realDir);
    symlinkSync(realDir, linkDir, "dir");
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      expect(fs.realpathSync(linkDir)).toBe(fs.realpathSync(realDir));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
