import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { buildGraph, checkGraphRoot, ensureBackgroundGraph, getBackgroundGraph } from "./build";

const created: string[] = [];

function makeDir(withMarker: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "graph-guard-"));
  created.push(dir);
  if (withMarker) writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("checkGraphRoot — refuses non-project roots", () => {
  test("skips the home directory", () => {
    const result = checkGraphRoot(homedir());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("home directory");
  });

  test("skips the filesystem root", () => {
    expect(checkGraphRoot("/").ok).toBe(false);
  });

  test("skips /home (ancestor of the home directory)", () => {
    expect(checkGraphRoot("/home").ok).toBe(false);
  });

  test("skips /tmp", () => {
    expect(checkGraphRoot("/tmp").ok).toBe(false);
  });

  test("skips a directory with no project marker", () => {
    const dir = makeDir(false);
    mkdirSync(path.join(dir, "src"));
    const result = checkGraphRoot(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no project marker");
  });

  test("accepts a directory with a project marker", () => {
    const dir = makeDir(true);
    const result = checkGraphRoot(dir);
    expect(result.ok).toBe(true);
    expect(result.root).toBe(dir);
  });
});

describe("graph build skips unsafe roots", () => {
  test("buildGraph returns an empty graph for the home directory", () => {
    const result = buildGraph(homedir());
    expect(result.fileCount).toBe(0);
    expect(result.symbolCount).toBe(0);
    expect(created.length).toBe(0);
  });

  test("ensureBackgroundGraph does not start a build for an unmarked temp dir", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "graph-guard-"));
    created.push(dir);
    ensureBackgroundGraph(dir);
    expect(getBackgroundGraph()).toBeNull();
  });
});
