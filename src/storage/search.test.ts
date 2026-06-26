import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations";
import { searchByEmbedding } from "./search";
import { getHNSWIndex } from "../infrastructure/vector/hnsw-index";
import type { MemoryScope } from "./types";

function makeEmbedding(...values: number[]): number[] {
  const emb = new Array(384).fill(0);
  for (let i = 0; i < Math.min(values.length, 384); i++) {
    emb[i] = values[i] ?? 0;
  }
  return emb;
}

function setup() {
  const globalDb = new Database(":memory:");
  const projectDb = new Database(":memory:");
  runMigrations(globalDb);
  runMigrations(projectDb);

  const dbs = new Map<MemoryScope, Database>([
    ["global", globalDb],
    ["project", projectDb],
  ]);

  const getDb = async (scope: MemoryScope): Promise<Database> => {
    const db = dbs.get(scope);
    if (!db) throw new Error(`No DB for scope: ${scope}`);
    return db;
  };

  function insertNode(
    db: Database,
    overrides: {
      id: string;
      scope?: string;
      label?: string;
      content?: string;
      embedding?: number[] | null;
      level?: number;
      importance?: number;
      confidence?: number;
      usefulnessScore?: number;
      category?: string;
      lastAccessed?: number | null;
      type?: string | null;
      expiresAt?: number | null;
      projectName?: string | null;
    },
  ) {
    const now = Date.now();
    const embedding = overrides.embedding ?? null;
    const embeddingJson = embedding ? JSON.stringify(embedding) : null;
    const embBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;

    db.run(
      `INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, confidence, last_verified, usefulness_score, category, expires_at, project_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        overrides.id,
        overrides.scope ?? "project",
        overrides.label ?? "test",
        overrides.content ?? "content",
        null,
        overrides.level ?? 0,
        null,
        embeddingJson,
        embBlob,
        now,
        now,
        overrides.importance ?? 0.5,
        0,
        overrides.lastAccessed ?? null,
        overrides.type ?? "note",
        null,
        0,
        overrides.confidence ?? 0.5,
        null,
        overrides.usefulnessScore ?? 0,
        overrides.category ?? null,
        overrides.expiresAt ?? null,
        overrides.projectName ?? null,
      ],
    );
  }

  return { getDb, globalDb, projectDb, dbs, insertNode };
}

describe("searchByEmbedding", () => {
  beforeEach(() => {
    getHNSWIndex().rebuild([]);
  });

  test("returns empty array when no nodes in HNSW or DB", async () => {
    const { getDb } = setup();
    const query = makeEmbedding(0.1, 0.2);
    const results = await searchByEmbedding(getDb, query, 5);
    expect(results).toEqual([]);
  });

  test("returns nodes matching HNSW search", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5, 0.3);
    const query = makeEmbedding(0.5, 0.3);
    insertNode(projectDb, { id: "n1", embedding: emb, scope: "project" });
    insertNode(projectDb, { id: "n2", embedding: makeEmbedding(-0.5, -0.3), scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "n1", embedding: emb, scope: "project" },
      { id: "n2", embedding: makeEmbedding(-0.5, -0.3), scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, query, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.id).toBe("n1");
  });

  test("respects limit parameter", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.1);
    const nodes = Array.from({ length: 10 }, (_, i) => {
      const id = `n-${i}`;
      insertNode(projectDb, { id, embedding: makeEmbedding(0.1 + i * 0.01), scope: "project" });
      return { id, embedding: makeEmbedding(0.1 + i * 0.01), scope: "project" as const };
    });

    await getHNSWIndex().rebuild(nodes);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.1), 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("filters by minLevel and maxLevel", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "low", embedding: emb, level: 0, scope: "project" });
    insertNode(projectDb, { id: "mid", embedding: emb, level: 2, scope: "project" });
    insertNode(projectDb, { id: "high", embedding: emb, level: 4, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "low", embedding: emb, scope: "project" },
      { id: "mid", embedding: emb, scope: "project" },
      { id: "high", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { minLevel: 2, maxLevel: 3 });
    expect(results.find(n => n.id === "low")).toBeUndefined();
    expect(results.find(n => n.id === "mid")).toBeDefined();
    expect(results.find(n => n.id === "high")).toBeUndefined();
  });

  test("filters by category", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "ep", embedding: emb, category: "episodic", scope: "project" });
    insertNode(projectDb, { id: "sem", embedding: emb, category: "semantic", scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "ep", embedding: emb, scope: "project" },
      { id: "sem", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { categoryFilter: "semantic" });
    expect(results.find(n => n.id === "ep")).toBeUndefined();
    expect(results.find(n => n.id === "sem")).toBeDefined();
  });

  test("filters by type", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "note", embedding: emb, type: "note", scope: "project" });
    insertNode(projectDb, { id: "storedctx", embedding: emb, type: "storedcontext", scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "note", embedding: emb, scope: "project" },
      { id: "storedctx", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { typeFilter: "storedcontext" });
    expect(results.find(n => n.id === "note")).toBeUndefined();
    expect(results.find(n => n.id === "storedctx")).toBeDefined();
  });

  test("typeFilter returns all types when not specified", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "a", embedding: emb, type: "note", scope: "project" });
    insertNode(projectDb, { id: "b", embedding: emb, type: "storedcontext", scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "a", embedding: emb, scope: "project" },
      { id: "b", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10);
    expect(results.find(n => n.id === "a")).toBeDefined();
    expect(results.find(n => n.id === "b")).toBeDefined();
  });

  test("filters by minUsefulness", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "useful", embedding: emb, usefulnessScore: 5, scope: "project" });
    insertNode(projectDb, { id: "useless", embedding: emb, usefulnessScore: 0, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "useful", embedding: emb, scope: "project" },
      { id: "useless", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { minUsefulness: 3 });
    expect(results.find(n => n.id === "useful")).toBeDefined();
    expect(results.find(n => n.id === "useless")).toBeUndefined();
  });

  test("applies level weights", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "l0", embedding: emb, level: 0, scope: "project" });
    insertNode(projectDb, { id: "l4", embedding: emb, level: 4, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "l0", embedding: emb, scope: "project" },
      { id: "l4", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, {
      levelWeights: { 0: 2.0, 4: 0.1 },
    });
    const l0 = results.find(n => n.id === "l0");
    const l4 = results.find(n => n.id === "l4");
    expect(l0).toBeDefined();
    expect(l4).toBeDefined();
    expect(l0!.importance).toBeGreaterThan(l4!.importance);
  });

  test("searches only project scope when projectName is set", async () => {
    const { getDb, globalDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(globalDb, { id: "global-node", embedding: emb, scope: "global" });
    insertNode(projectDb, { id: "project-node", embedding: emb, scope: "project", projectName: "my-project" });

    await getHNSWIndex().rebuild([
      { id: "global-node", embedding: emb, scope: "global" },
      { id: "project-node", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { projectName: "my-project" });
    expect(results.find(n => n.id === "global-node")).toBeUndefined();
    expect(results.find(n => n.id === "project-node")).toBeDefined();
  });

  test("increments times_used on returned nodes", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);
    insertNode(projectDb, { id: "usage-test", embedding: emb, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "usage-test", embedding: emb, scope: "project" },
    ]);

    await searchByEmbedding(getDb, makeEmbedding(0.5), 10);

    const row = projectDb.query("SELECT times_used FROM memory_nodes WHERE id = ?").get("usage-test") as { times_used: number } | null;
    expect(row!.times_used).toBe(1);
  });

  test("fallback path: uses cosine similarity when HNSW returns no results", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5, 0.3, 0.1);
    insertNode(projectDb, { id: "fallback-node", embedding: emb, scope: "project" });

    // Don't rebuild HNSW — HNSW will return no results
    // searchByEmbedding should fall back to cosine similarity
    const query = makeEmbedding(0.5, 0.3, 0.1);
    const results = await searchByEmbedding(getDb, query, 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(n => n.id === "fallback-node")).toBe(true);
  });

  test("excludes expired nodes", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "alive", embedding: emb, scope: "project", expiresAt: null });
    insertNode(projectDb, { id: "expired", embedding: emb, scope: "project", expiresAt: Date.now() - 1000 });

    await getHNSWIndex().rebuild([
      { id: "alive", embedding: emb, scope: "project" },
      { id: "expired", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10);
    expect(results.find(n => n.id === "alive")).toBeDefined();
    expect(results.find(n => n.id === "expired")).toBeUndefined();
  });

  test("returns nodes from both global and project scope", async () => {
    const { getDb, globalDb, projectDb, insertNode } = setup();
    const globalEmb = new Array(384).fill(0);
    globalEmb[0] = 1.0;
    const projectEmb = new Array(384).fill(0);
    projectEmb[1] = 1.0;

    insertNode(globalDb, { id: "g-node", embedding: globalEmb, scope: "global" });
    insertNode(projectDb, { id: "p-node", embedding: projectEmb, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "g-node", embedding: globalEmb, scope: "global" },
      { id: "p-node", embedding: projectEmb, scope: "project" },
    ]);

    const query = new Array(384).fill(0);
    query[0] = 1.0;
    query[1] = 1.0;
    const results = await searchByEmbedding(getDb, query, 10);
    expect(results.find(n => n.id === "g-node")).toBeDefined();
    expect(results.find(n => n.id === "p-node")).toBeDefined();
  });
});

describe("searchByEmbedding temporal expansion", () => {
  function setupWithTemporalEdges() {
    const env = setup();

    function insertTemporalEdge(sourceId: string, targetId: string, edgeType: string = "NEXT") {
      env.projectDb.run(
        "INSERT INTO temporal_edges (source_node_id, target_node_id, edge_type, created_at) VALUES (?, ?, ?, ?)",
        [sourceId, targetId, edgeType, Date.now()],
      );
    }

    return { ...env, insertTemporalEdge };
  }

  beforeEach(() => {
    getHNSWIndex().rebuild([]);
  });

  test("temporalHops=0 adds no extra nodes", async () => {
    const { getDb, projectDb, insertNode, insertTemporalEdge } = setupWithTemporalEdges();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "seed", embedding: emb, scope: "project" });
    insertNode(projectDb, { id: "related", embedding: emb, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "seed", embedding: emb, scope: "project" },
      { id: "related", embedding: emb, scope: "project" },
    ]);

    insertTemporalEdge("seed", "related");

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { temporalHops: 0 });
    expect(results.find(n => n.id === "seed")).toBeDefined();
    expect(results.find(n => n.id === "related")).toBeDefined();
    // Both should be found via HNSW, not temporal expansion
  });

  test("temporalHops > 0 adds temporally adjacent nodes", async () => {
    const { getDb, projectDb, insertNode, insertTemporalEdge } = setupWithTemporalEdges();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "seed", embedding: emb, scope: "project" });
    // This node has no direct embedding match but is temporally connected
    const unrelatedEmb = makeEmbedding(-0.9, -0.9);
    insertNode(projectDb, { id: "temp-adjacent", embedding: unrelatedEmb, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "seed", embedding: emb, scope: "project" },
      { id: "temp-adjacent", embedding: unrelatedEmb, scope: "project" },
    ]);

    insertTemporalEdge("seed", "temp-adjacent", "NEXT");

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { temporalHops: 1 });
    const tempNode = results.find(n => n.id === "temp-adjacent");
    expect(tempNode).toBeDefined();
    expect(tempNode!.importance).toBeGreaterThan(0);
  });

  test("temporal expansion respects 2 hops", async () => {
    const { getDb, projectDb, insertNode, insertTemporalEdge } = setupWithTemporalEdges();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "seed", embedding: emb, scope: "project" });
    const unrelated = makeEmbedding(-0.9, -0.9);
    insertNode(projectDb, { id: "hop1", embedding: unrelated, scope: "project" });
    insertNode(projectDb, { id: "hop2", embedding: unrelated, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "seed", embedding: emb, scope: "project" },
      { id: "hop1", embedding: unrelated, scope: "project" },
      { id: "hop2", embedding: unrelated, scope: "project" },
    ]);

    insertTemporalEdge("seed", "hop1", "NEXT");
    insertTemporalEdge("hop1", "hop2", "NEXT");

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { temporalHops: 2 });
    const hop1 = results.find(n => n.id === "hop1");
    const hop2 = results.find(n => n.id === "hop2");
    expect(hop1).toBeDefined();
    expect(hop2).toBeDefined();
    // hop1 should have higher score than hop2 (score decay)
    expect(hop1!.importance).toBeGreaterThan(hop2!.importance);
  });

  test("temporal expansion with DURING_SESSION edges at depth 0", async () => {
    const { getDb, projectDb, insertNode, insertTemporalEdge } = setupWithTemporalEdges();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "seed", embedding: emb, scope: "project" });
    const unrelated = makeEmbedding(-0.9, -0.9);
    insertNode(projectDb, { id: "session-mate", embedding: unrelated, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "seed", embedding: emb, scope: "project" },
      { id: "session-mate", embedding: unrelated, scope: "project" },
    ]);

    insertTemporalEdge("seed", "session-mate", "DURING_SESSION");

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { temporalHops: 1 });
    expect(results.find(n => n.id === "session-mate")).toBeDefined();
  });

  test("empty queryText skips BM25 computation but temporal still works", async () => {
    const { getDb, projectDb, insertNode, insertTemporalEdge } = setupWithTemporalEdges();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "seed", embedding: emb, scope: "project" });
    const unrelated = makeEmbedding(-0.9, -0.9);
    insertNode(projectDb, { id: "temp-node", embedding: unrelated, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "seed", embedding: emb, scope: "project" },
      { id: "temp-node", embedding: unrelated, scope: "project" },
    ]);

    insertTemporalEdge("seed", "temp-node", "NEXT");

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, { queryText: "", temporalHops: 1 });
    expect(results.find(n => n.id === "temp-node")).toBeDefined();
  });
});

describe("searchByEmbedding BM25 integration", () => {
  beforeEach(() => {
    getHNSWIndex().rebuild([]);
  });

  test("computes BM25 scores when queryText is provided", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "match", embedding: emb, content: "hello world foo bar hello world", scope: "project" });
    insertNode(projectDb, { id: "no-match", embedding: emb, content: "completely unrelated content", scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "match", embedding: emb, scope: "project" },
      { id: "no-match", embedding: emb, scope: "project" },
    ]);

    // With queryText, BM25 boosts the matching node
    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10, {
      queryText: "hello world",
      bm25Weight: 0.5,
    });

    const matchIdx = results.findIndex(n => n.id === "match");
    const noMatchIdx = results.findIndex(n => n.id === "no-match");
    expect(matchIdx).toBeLessThan(noMatchIdx);
  });

  test("works without queryText (no BM25)", async () => {
    const { getDb, projectDb, insertNode } = setup();
    const emb = makeEmbedding(0.5);

    insertNode(projectDb, { id: "n1", embedding: emb, scope: "project" });

    await getHNSWIndex().rebuild([
      { id: "n1", embedding: emb, scope: "project" },
    ]);

    const results = await searchByEmbedding(getDb, makeEmbedding(0.5), 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("with rerank enabled (10+ candidates)", async () => {
    const { getDb, projectDb, insertNode } = setup();

    // Create embeddings with varied directions (different dimensions activated)
    // so cosine similarity varies meaningfully
    const nodes = Array.from({ length: 15 }, (_, i) => {
      const emb = new Array(384).fill(0);
      emb[i] = 1.0;
      return { id: `n-${i}`, embedding: emb, content: `item ${i}`, scope: "project" as const };
    });
    for (const n of nodes) {
      insertNode(projectDb, { id: n.id, embedding: n.embedding, content: n.content, scope: n.scope });
    }
    await getHNSWIndex().rebuild(nodes);

    // Query close to n-5's embedding dimension
    const queryEmb = new Array(384).fill(0);
    queryEmb[5] = 1.0;
    const results = await searchByEmbedding(getDb, queryEmb, 10, {
      queryText: "item 5",
      rerank: true,
    });
    expect(results.length).toBeGreaterThan(5);
    expect(results.some(n => n.id === "n-5")).toBe(true);
  });
});
