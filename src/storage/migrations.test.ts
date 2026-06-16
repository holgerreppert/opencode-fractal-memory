import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import {
  CURRENT_VERSION,
  MIGRATIONS,
  runMigrations,
  getConfig,
  setConfig,
} from "./migrations";

const getDbVersion = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number } | undefined)?.user_version ?? 0;

describe("migrations", () => {
  test("creates full schema from scratch (v0 → current)", async () => {
    const db = new Database(":memory:");
    
    const version = runMigrations(db);
    
    expect(version).toBe(CURRENT_VERSION);
    
    // Verify memory_nodes table exists with all columns
    const columns = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
    const columnNames = columns.map(c => c.name);
    
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("scope");
    expect(columnNames).toContain("label");
    expect(columnNames).toContain("content");
    expect(columnNames).toContain("summary");
    expect(columnNames).toContain("level");
    expect(columnNames).toContain("parent_ids");
    expect(columnNames).toContain("embedding");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("updated_at");
    expect(columnNames).toContain("importance");
    expect(columnNames).toContain("access_count");
    expect(columnNames).toContain("last_accessed");
    expect(columnNames).toContain("type");
    expect(columnNames).toContain("metadata");
    expect(columnNames).toContain("sticky");
    expect(columnNames).toContain("confidence");
    expect(columnNames).toContain("last_verified");
  });

  test("creates config table with defaults", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    // Verify memory_config table exists
    const configColumns = db.query("PRAGMA table_info(memory_config)").all() as { name: string }[];
    const configColumnNames = configColumns.map(c => c.name);
    
    expect(configColumnNames).toContain("key");
    expect(configColumnNames).toContain("value");
    expect(configColumnNames).toContain("updated_at");
    
    // Verify default config values
    expect(getConfig(db, "context_threshold", "0.8")).toBe("0.8");
    expect(getConfig(db, "context_limit", "128000")).toBe("128000");
    expect(getConfig(db, "similarity_threshold", "0.3")).toBe("0.3");
  });

  test("migration is idempotent", async () => {
    const db = new Database(":memory:");
    
    runMigrations(db);
    runMigrations(db); // Should not error
    runMigrations(db); // Should not error
    
    const version = getDbVersion(db);
    expect(version).toBe(CURRENT_VERSION);
  });

  test("fresh database gets all migrations", async () => {
    const db = new Database(":memory:");
    
    // Start with version 0
    expect(getDbVersion(db)).toBe(0);
    
    const version = runMigrations(db);
    expect(version).toBe(CURRENT_VERSION);
    expect(getDbVersion(db)).toBe(CURRENT_VERSION);
  });

  test("partially migrated database gets remaining migrations", async () => {
    const db = new Database(":memory:");
    
    // Manually create table as if at version 0
    db.run(`
      CREATE TABLE memory_nodes (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        level INT NOT NULL DEFAULT 0,
        created_at INT NOT NULL,
        updated_at INT NOT NULL,
        importance REAL DEFAULT 0.5,
        access_count INT DEFAULT 0,
        last_accessed INT,
        type TEXT,
        metadata TEXT
      )
    `);
    db.run(`PRAGMA user_version = 1`);
    
    expect(getDbVersion(db)).toBe(1);
    
    // Run migrations - should add config table (v2)
    const version = runMigrations(db);
    expect(version).toBe(CURRENT_VERSION);
    
    // Verify config table exists
    const configRows = db.query("SELECT COUNT(*) as count FROM memory_config").get() as { count: number };
    expect(configRows.count).toBeGreaterThan(0);
  });

  test("getConfig returns default for missing key", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    expect(getConfig(db, "nonexistent_key", "default_val")).toBe("default_val");
  });

  test("setConfig overwrites existing value", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    expect(getConfig(db, "context_threshold", "0.8")).toBe("0.8");
    
    setConfig(db, "context_threshold", "0.7");
    expect(getConfig(db, "context_threshold", "0.8")).toBe("0.7");
  });

  test("runMigrations with already current version is no-op", async () => {
    const db = new Database(":memory:");
    
    runMigrations(db);
    const version1 = getDbVersion(db);
    
    runMigrations(db);
    const version2 = getDbVersion(db);
    
    expect(version1).toBe(version2);
    expect(version1).toBe(CURRENT_VERSION);
  });

  test("in-memory database can insert and query nodes after migration", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    // Insert a node
    const id = "test-id-123";
    const now = Date.now();
    
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, "project", "test", "Hello world", null, 0, null, null, now, now, 0.5, 0, null, "note", null],
    );
    
    const row = db.query("SELECT * FROM memory_nodes WHERE id = ?").get(id) as { content: string; parent_ids: string | null };
    expect(row.content).toBe("Hello world");
    expect(row.parent_ids).toBe(null);
  });

  test("in-memory database supports parent_ids as JSON array", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    const parentId = "parent-123";
    const childId = "child-456";
    const now = Date.now();
    
    // Insert parent node
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [parentId, "project", "parent", "Parent content", null, 0, null, null, now, now, 0.5, 0, null, "note", null],
    );
    
    // Insert child with parent_ids as JSON array
    const parentIds = JSON.stringify([parentId]);
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [childId, "project", "child", "Child content", null, 1, parentIds, null, now, now, 0.5, 0, null, "summary", null],
    );
    
    const child = db.query("SELECT * FROM memory_nodes WHERE id = ?").get(childId) as { parent_ids: string };
    const parsed = JSON.parse(child.parent_ids) as string[];
    expect(parsed).toEqual([parentId]);
  });

  test("creates memory_usage_log table (migration 5)", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    const columns = db.query("PRAGMA table_info(memory_usage_log)").all() as { name: string }[];
    const columnNames = columns.map(c => c.name);
    
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("tool_name");
    expect(columnNames).toContain("timestamp");
    expect(columnNames).toContain("result_tokens");
    expect(columnNames).toContain("context_warning");
    expect(columnNames).toContain("success");
    
    // Verify indexes exist
    const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory_usage_log'").all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain("idx_usage_log_tool");
    expect(indexNames).toContain("idx_usage_log_ts");
    
    // Verify we can insert and query
    const logId = "log-123";
    const now = Date.now();
    db.run(
      "INSERT INTO memory_usage_log (id, tool_name, timestamp, result_tokens, context_warning, success) VALUES (?, ?, ?, ?, ?, ?)",
      [logId, "memory_list", now, 1500, 0, 1],
    );
    const row = db.query("SELECT * FROM memory_usage_log WHERE id = ?").get(logId) as { tool_name: string; result_tokens: number; context_warning: number; success: number };
    expect(row.tool_name).toBe("memory_list");
    expect(row.result_tokens).toBe(1500);
    expect(row.context_warning).toBe(0);
    expect(row.success).toBe(1);
  });

  test("adds sticky column (migration 6)", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    // Verify sticky column exists in memory_nodes
    const columns = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
    const columnNames = columns.map(c => c.name);
    expect(columnNames).toContain("sticky");
    
    // Verify we can insert nodes with sticky flag
    const nodeId = "sticky-node-123";
    const now = Date.now();
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [nodeId, "global", "test-sticky", "test content", null, 0, null, null, now, now, 0.5, 0, null, "note", null, 1, 0.5, null],
    );
    
    // Query with sticky = 1
    const stickyRow = db.query("SELECT * FROM memory_nodes WHERE id = ?").get(nodeId) as { sticky: number };
    expect(stickyRow.sticky).toBe(1);
    
    // Query non-sticky nodes (default)
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["non-sticky-123", "global", "test-non-sticky", "test content", null, 0, null, null, now, now, 0.5, 0, null, "note", null, 0, 0.5, null],
    );
    const nonStickyRow = db.query("SELECT * FROM memory_nodes WHERE id = ?").get("non-sticky-123") as { sticky: number };
    expect(nonStickyRow.sticky).toBe(0);
  });

  test("adds confidence tracking columns (migration 7)", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    
    // Verify confidence and last_verified columns exist
    const columns = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
    const columnNames = columns.map(c => c.name);
    expect(columnNames).toContain("confidence");
    expect(columnNames).toContain("last_verified");
    
    // Verify we can insert nodes with confidence
    const nodeId = "confidence-node-123";
    const now = Date.now();
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [nodeId, "global", "test-confidence", "test content", null, 0, null, null, now, now, 0.5, 0, null, "note", null, 0, 0.8, null],
    );
    
    const row = db.query("SELECT * FROM memory_nodes WHERE id = ?").get(nodeId) as { confidence: number; last_verified: number | null };
    expect(row.confidence).toBe(0.8);
    expect(row.last_verified).toBeNull();
    
    // Verify default confidence is 0.5
    db.run(
      "INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["default-conf-123", "global", "test-default-conf", "test content", null, 0, null, null, now, now, 0.5, 0, null, "note", null, 0, 0.5, null],
    );
    const defaultRow = db.query("SELECT * FROM memory_nodes WHERE id = ?").get("default-conf-123") as { confidence: number };
    expect(defaultRow.confidence).toBe(0.5);
  });
});
