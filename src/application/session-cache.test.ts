import { describe, expect, test, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionCache } from "./session-cache";

const TEST_DIR = path.join(os.tmpdir(), "opencode-session-cache-test");

function makeCache(sessionId: string): SessionCache {
  return new SessionCache(sessionId, 60);
}

const createdSessions: string[] = [];

function ucache(label: string): SessionCache {
  const id = `test-${label}-${Date.now()}`;
  createdSessions.push(id);
  return makeCache(id);
}

describe("SessionCache", () => {
  afterAll(() => {
    const cacheDir = path.join(os.homedir(), ".config", "opencode", "scratch");
    for (const sid of createdSessions) {
      try {
        fs.rmSync(path.join(cacheDir, `session-${sid}-cache.json`), { force: true });
      } catch { /* ok */ }
    }
  });

  test("starts empty", () => {
    const cache = ucache("empty");
    expect(cache.size).toBe(0);
    cache.destroy();
  });

  test("getOutputHash returns consistent hash", () => {
    const cache = ucache("hash");
    const h1 = cache.getOutputHash("hello world");
    const h2 = cache.getOutputHash("hello world");
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
    cache.destroy();
  });

  test("different inputs produce different hashes", () => {
    const cache = ucache("hash-diff");
    const h1 = cache.getOutputHash("hello world");
    const h2 = cache.getOutputHash("hello world!");
    expect(h1).not.toBe(h2);
    cache.destroy();
  });

  test("set then get returns stored entry", () => {
    const cache = ucache("set-get");
    const hash = cache.getOutputHash("output data");
    cache.set(hash, "output data", "test");
    const entry = cache.get(hash);
    expect(entry).not.toBeUndefined();
    expect(entry!.output).toBe("output data");
    expect(entry!.strategy).toBe("test");
    cache.destroy();
  });

  test("get returns undefined for missing hash", () => {
    const cache = ucache("missing");
    expect(cache.get("nonexistent")).toBeUndefined();
    cache.destroy();
  });

  test("clear empties cache", () => {
    const cache = ucache("clear");
    const hash = cache.getOutputHash("data");
    cache.set(hash, "data", "test");
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    cache.destroy();
  });

  test("set updates entry on re-set", () => {
    const cache = ucache("re-set");
    const hash = cache.getOutputHash("data");
    cache.set(hash, "v1", "test");
    cache.set(hash, "v2", "test");
    expect(cache.get(hash)!.output).toBe("v2");
    cache.destroy();
  });

  test("persists data across flush and reload", () => {
    const sid = `persist-test-${Date.now()}`;
    createdSessions.push(sid);
    const cache = new SessionCache(sid, 60);
    const hash = cache.getOutputHash("persist data");
    cache.set(hash, "persist data", "test");
    cache.flush();
    cache.destroy();

    const cache2 = new SessionCache(sid, 60);
    const entry = cache2.get(hash);
    expect(entry).not.toBeUndefined();
    expect(entry!.output).toBe("persist data");
    cache2.destroy();
  });

  test("returns expected entry shape", () => {
    const cache = ucache("shape");
    const hash = cache.getOutputHash("shape data");
    cache.set(hash, "shape data", "strategy-x");
    const got = cache.get(hash);
    expect(got?.output).toBe("shape data");
    expect(got?.strategy).toBe("strategy-x");
    expect(typeof got?.timestamp).toBe("number");
    cache.destroy();
  });
});
