import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrateFromProjectDb } from "./project-db-migration";
import { runMigrations } from "./migrations";

let dir: string;

function makeProvider(oldDbPath: string | null) {
  const unified = new Database(":memory:");
  runMigrations(unified);
  return {
    provider: {
      projectDirectory: dir,
      async getDb(): Promise<Database> {
        return unified;
      },
    },
    unified,
    projectName: "testproject",
  };
}

describe("migrateFromProjectDb", () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "projdbmig-"));
    mkdirSync(path.join(dir, ".opencode"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns 0 when no project DB exists", async () => {
    const { provider, projectName } = makeProvider(null);
    expect(await migrateFromProjectDb(provider, projectName)).toBe(0);
  });

  test("empty/legacy DB without tables is a no-op, not a crash (bewerberapp bug)", async () => {
    writeFileSync(path.join(dir, ".opencode-memory-placeholder"), "");
    const { provider, projectName, unified } = makeProvider(null);
    // Create the stale empty DB at the exact expected path
    const stale = new Database(path.join(dir, ".opencode", "memory.db"));
    stale.run("PRAGMA journal_mode=WAL");
    stale.close();
    const migrated = await migrateFromProjectDb(provider, projectName);
    expect(migrated).toBe(0);
    const count = unified.query("SELECT COUNT(*) AS n FROM memory_nodes").get() as { n: number };
    expect(count.n).toBe(0);
  });

  test("migrates nodes from a legacy project DB", async () => {
    const { provider, projectName, unified } = makeProvider(null);
    const old = new Database(path.join(dir, ".opencode", "memory.db"));
    old.run(`CREATE TABLE memory_nodes (
      id TEXT PRIMARY KEY, scope TEXT, label TEXT, content TEXT, summary TEXT,
      level INTEGER, parent_ids TEXT, embedding TEXT, embedding_blob BLOB,
      created_at INTEGER, updated_at INTEGER, importance REAL, access_count INTEGER,
      last_accessed INTEGER, type TEXT, metadata TEXT, sticky INTEGER DEFAULT 0,
      ttl_days INTEGER, expires_at INTEGER, confidence REAL DEFAULT 0.5,
      last_verified INTEGER, usefulness_score REAL DEFAULT 0, times_used INTEGER DEFAULT 0,
      times_helpful INTEGER DEFAULT 0
    )`);
    old.run(`INSERT INTO memory_nodes (id, scope, label, content, level, created_at, updated_at, importance)
             VALUES ('n1', 'project', 'old-node', 'legacy content', 0, 1, 1, 0.5)`);
    old.close();

    const migrated = await migrateFromProjectDb(provider, projectName);
    expect(migrated).toBe(1);
    const row = unified.query("SELECT id, label, project_name FROM memory_nodes WHERE id = 'n1'").get() as { label: string; project_name: string };
    expect(row.label).toBe("old-node");
    expect(row.project_name).toBe(projectName);

    // Idempotent: second run skips existing
    expect(await migrateFromProjectDb(provider, projectName)).toBe(0);
  });
});
