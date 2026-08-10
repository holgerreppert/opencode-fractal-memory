import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MemConfig } from "../../infrastructure/config/config";
import { createReReadEliminationHandler } from "./re-read-elimination";
import { configureReadCache, invalidateCacheEntry } from "../../application/re-read-elimination";

function makeConfig(enabled: boolean): MemConfig {
  return {
    injectionVisibility: { enabled: true, markers: true, digest: true },
    reReadElimination: { enabled, maxCacheSize: 100 },
  } as MemConfig;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reread-test-"));
  configureReadCache(100);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function readOnce(handler: ReturnType<typeof createReReadEliminationHandler>, filePath: string, callID: string, output: string) {
  const out: { output?: string; metadata?: Record<string, unknown> } = { output };
  await handler["tool.after"]!({ tool: "read", args: { filePath }, sessionID: "s1", callID }, out);
  return out;
}

describe("createReReadEliminationHandler — tool.after serve + cache", () => {
  test("caches a large fresh read", async () => {
    const file = path.join(tmpDir, "a.ts");
    const content = "export const x = 1;\n".repeat(10);
    fs.writeFileSync(file, content);
    const handler = createReReadEliminationHandler(makeConfig(true));

    const out = await readOnce(handler, file, "c1", content);
    expect(out.output).toBe(content);
    expect(out.metadata?.reread_eliminated).toBeUndefined();
  });

  test("serves cached content on unchanged re-read with marker", async () => {
    const file = path.join(tmpDir, "b.ts");
    const content = "export const y = 2;\n".repeat(10);
    fs.writeFileSync(file, content);
    const handler = createReReadEliminationHandler(makeConfig(true));

    await readOnce(handler, file, "c1", content);
    const out = await readOnce(handler, file, "c2", content);
    expect(out.output).toContain("[File unchanged since turn");
    expect(out.output).toContain(content);
    expect(out.metadata?.reread_eliminated).toBe(true);
  });

  test("does not serve when file changed (re-caches new content)", async () => {
    const file = path.join(tmpDir, "c.ts");
    const v1 = "export const z = 1;\n".repeat(10);
    const v2 = "export const z = 2;\n".repeat(10);
    fs.writeFileSync(file, v1);
    const handler = createReReadEliminationHandler(makeConfig(true));

    await readOnce(handler, file, "c1", v1);
    // Simulate file edit by updating mtime + content.
    fs.writeFileSync(file, v2);
    const past = new Date(Date.now() - 5000);
    fs.utimesSync(file, past, past);
    const out = await readOnce(handler, file, "c2", v2);
    expect(out.output).not.toContain("[File unchanged");
    expect(out.output).toBe(v2);
    expect(out.metadata?.reread_eliminated).toBeUndefined();
  });

  test("skips offset reads (no serve, no cache)", async () => {
    const file = path.join(tmpDir, "d.ts");
    const content = "export const q = 3;\n".repeat(10);
    fs.writeFileSync(file, content);
    const handler = createReReadEliminationHandler(makeConfig(true));

    const out: { output?: string; metadata?: Record<string, unknown> } = { output: content };
    await handler["tool.after"]!({ tool: "read", args: { filePath: file, offset: 5 }, sessionID: "s1", callID: "c1" }, out);
    expect(out.metadata?.reread_eliminated).toBeUndefined();
    expect(out.output).toBe(content);
  });

  test("does not touch non-read tools", async () => {
    const handler = createReReadEliminationHandler(makeConfig(true));
    const out: { output?: string; metadata?: Record<string, unknown> } = { output: "x" };
    await handler["tool.after"]!({ tool: "bash", args: { command: "ls" }, sessionID: "s1", callID: "c1" }, out);
    expect(out.output).toBe("x");
    expect(out.metadata).toBeUndefined();
  });

  test("skips tiny outputs (below 80 chars)", async () => {
    const file = path.join(tmpDir, "e.ts");
    fs.writeFileSync(file, "short");
    const handler = createReReadEliminationHandler(makeConfig(true));
    const out = await readOnce(handler, file, "c1", "short");
    expect(out.metadata?.reread_eliminated).toBeUndefined();
    // Re-read of tiny file never caches → still no serve.
    const out2 = await readOnce(handler, file, "c2", "short");
    expect(out2.metadata?.reread_eliminated).toBeUndefined();
  });

  test("no-op when disabled", async () => {
    const file = path.join(tmpDir, "f.ts");
    const content = "export const w = 4;\n".repeat(10);
    fs.writeFileSync(file, content);
    const handler = createReReadEliminationHandler(makeConfig(false));
    const out = await readOnce(handler, file, "c1", content);
    expect(out.metadata?.reread_eliminated).toBeUndefined();
    invalidateCacheEntry(file);
  });
});
