import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations";
import { backfillBinaryEmbeddingsAndBM25, rebuildHNSWIndex, backfillLinks } from "./maintenance";
import { getHNSWIndex } from "../infrastructure/vector/hnsw-index";

type MemoryScopes = "global" | "project";

function setup() {
  const db = new Database(":memory:");
  runMigrations(db);

  const getDb = async (_scope: MemoryScopes): Promise<Database> => db;

  return { db, getDb };
}

function insertNode(
  db: Database,
  overrides: {
    id?: string;
    label?: string;
    content?: string;
    embedding?: number[] | null;
    embedding_blob?: Buffer | null;
    scope?: string;
  } = {},
) {
  const now = Date.now();
  const id = overrides.id ?? `n-${Math.random().toString(36).slice(2, 8)}`;
  const embedding = overrides.embedding ?? null;
  const embeddingJson = embedding ? JSON.stringify(embedding) : null;
  const embeddingBlob = overrides.embedding_blob ?? null;

  db.run(
    `INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.scope ?? "project",
      overrides.label ?? "test",
      overrides.content ?? "content",
      null,
      0,
      null,
      embeddingJson,
      embeddingBlob,
      now,
      now,
      0.5,
      0,
      null,
      "note",
      null,
      0,
      0.5,
      null,
    ],
  );
  return id;
}

describe("backfillLinks", () => {
  test("creates memory_links for wiki-link content", async () => {
    const { db, } = setup();
    insertNode(db, { id: "source-1", content: "This links to [[target-node]]" });
    insertNode(db, { id: "target-node", label: "target-node", content: "I am the target" });

    await backfillLinks(db);

    const link = db.query("SELECT source_id, target_label, target_id FROM memory_links").get() as { source_id: string; target_label: string; target_id: string } | null;
    expect(link).not.toBeNull();
    expect(link!.source_id).toBe("source-1");
    expect(link!.target_label).toBe("target-node");
    expect(link!.target_id).toBe("target-node");
  });

  test("skips nodes without wiki-links", async () => {
    const { db } = setup();
    insertNode(db, { id: "no-links", content: "Just plain text without any links" });

    await backfillLinks(db);

    const count = db.query("SELECT COUNT(*) as c FROM memory_links").get() as { c: number };
    expect(count.c).toBe(0);
  });

  test("handles unresolvable wiki-links with null target_id", async () => {
    const { db } = setup();
    insertNode(db, { id: "source-1", content: "Links to [[missing-node]]" });

    await backfillLinks(db);

    const link = db.query("SELECT source_id, target_label, target_id FROM memory_links").get() as { source_id: string; target_label: string; target_id: string | null } | null;
    expect(link).not.toBeNull();
    expect(link!.target_label).toBe("missing-node");
    expect(link!.target_id).toBeNull();
  });
});

describe("backfillBinaryEmbeddingsAndBM25", () => {
  test("skips when BM25 already populated and no blob conversion needed", async () => {
    const { db, } = setup();
    const id = insertNode(db, { content: "hello world" });

    // Pre-populate BM25
    db.run("INSERT INTO bm25_doc_stats (node_id, token_count, scope) VALUES (?, ?, ?)", [id, 2, "project"]);
    db.run("INSERT INTO bm25_index (term, node_id, frequency, scope) VALUES (?, ?, ?, ?)", ["hello", id, 1, "project"]);
    db.run("INSERT INTO bm25_index (term, node_id, frequency, scope) VALUES (?, ?, ?, ?)", ["world", id, 1, "project"]);

    await backfillBinaryEmbeddingsAndBM25(db, "project");

    // Should NOT have added more rows
    const statsCount = db.query("SELECT COUNT(*) as c FROM bm25_doc_stats").get() as { c: number };
    expect(statsCount.c).toBe(1);
  });

  test("runs when BM25 has no rows for this scope", async () => {
    const { db } = setup();
    insertNode(db, { id: "node-1", content: "some content" });

    await backfillBinaryEmbeddingsAndBM25(db, "project");

    const statsRow = db.query("SELECT node_id, token_count FROM bm25_doc_stats WHERE scope = ?").get("project") as { node_id: string; token_count: number } | null;
    expect(statsRow).not.toBeNull();
    expect(statsRow!.node_id).toBe("node-1");
  });

  test("converts JSON embedding to blob when embedding_blob is null", async () => {
    const { db } = setup();
    const emb = Array.from({length: 384}).fill(0.1);
    insertNode(db, { id: "convert-me", embedding: emb, embedding_blob: null });

    await backfillBinaryEmbeddingsAndBM25(db, "project");

    const row = db.query("SELECT embedding_blob FROM memory_nodes WHERE id = ?").get("convert-me") as { embedding_blob: Buffer | null } | null;
    expect(row).not.toBeNull();
    expect(row!.embedding_blob).not.toBeNull();
    expect(row!.embedding_blob!.length).toBeGreaterThan(0);
  });

  test("runs for both global and project scopes without error", async () => {
    const { db } = setup();
    insertNode(db, { id: "global-node", content: "global content", scope: "global" });
    insertNode(db, { id: "project-node", content: "project content", scope: "project" });

    await backfillBinaryEmbeddingsAndBM25(db, "global");
    await backfillBinaryEmbeddingsAndBM25(db, "project");

    const totalStats = db.query("SELECT COUNT(*) as c FROM bm25_doc_stats").get() as { c: number };
    expect(totalStats.c).toBe(2);
  });

  test("creates BM25 index entries with correct terms", async () => {
    const { db } = setup();
    insertNode(db, { id: "bm25-test", content: "hello world hello" });

    await backfillBinaryEmbeddingsAndBM25(db, "project");

    const terms = db.query("SELECT term, frequency FROM bm25_index WHERE node_id = ? ORDER BY term").all("bm25-test") as Array<{ term: string; frequency: number }>;
    // Tokenization includes the label ("test"), so we get hello(2), world(1), test(1)
    expect(terms.length).toBe(3);
    expect(terms.find(t => t.term === "hello")?.frequency).toBe(2);
    expect(terms.find(t => t.term === "world")?.frequency).toBe(1);
  });
});

describe("rebuildHNSWIndex", () => {
  beforeEach(() => {
    getHNSWIndex().rebuild([]);
  });

  test("skips when HNSW already matches DB node count", async () => {
    const { db, getDb } = setup();
    const emb = Array.from({length: 384}).fill(0.1);
    insertNode(db, { id: "n1", embedding: emb });

    // Build HNSW first
    await rebuildHNSWIndex(getDb, "project");

    // HNSW should now have 1 node — same as DB count
    const hnsw = getHNSWIndex();
    const statsBefore = hnsw.getStats();
    expect(statsBefore.projectNodes).toBe(1);

    // Run again — should skip
    await rebuildHNSWIndex(getDb, "project");

    const statsAfter = hnsw.getStats();
    expect(statsAfter.projectNodes).toBe(1);
  });

  test("rebuilds when HNSW count differs from DB", async () => {
    const { db, getDb } = setup();
    const emb = Array.from({length: 384}).fill(0.1);
    insertNode(db, { id: "n1", embedding: emb });

    // Build HNSW with 1 node
    await rebuildHNSWIndex(getDb, "project");

    // Add another node to DB (not yet in HNSW)
    insertNode(db, { id: "n2", embedding: emb });

    // Rebuild — should detect difference and rebuild
    await rebuildHNSWIndex(getDb, "project");

    const hnsw = getHNSWIndex();
    const stats = hnsw.getStats();
    expect(stats.projectNodes).toBe(2);
  });

  test("handles both global and project scopes", async () => {
    const { db, getDb } = setup();
    const emb = Array.from({length: 384}).fill(0.1);
    insertNode(db, { id: "g1", embedding: emb, scope: "global" });
    insertNode(db, { id: "p1", embedding: emb, scope: "project" });

    await rebuildHNSWIndex(getDb, "all");

    const hnsw = getHNSWIndex();
    const stats = hnsw.getStats();
    expect(stats.globalNodes).toBe(1);
    expect(stats.projectNodes).toBe(1);
  });

  test("does nothing when no nodes have embeddings", async () => {
    const { db, getDb } = setup();
    insertNode(db, { id: "no-emb", embedding: null });

    await rebuildHNSWIndex(getDb, "project");

    const hnsw = getHNSWIndex();
    const stats = hnsw.getStats();
    expect(stats.projectNodes).toBe(0);
  });
});
