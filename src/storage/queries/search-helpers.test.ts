import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations";
import type { MemoryNode } from "../types";
import {
  calculateDynamicBm25Weight,
  detectCodeQuery,
  computeRecencyScore,
  computeBM25TermScore,
  computeBM25Scores,
  computeBM25ScoresSQL,
  computeFinalScores,
  rerankResults,
  updateBM25Index,
  removeBM25Index,
} from "./search-helpers";

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: overrides.id ?? "node-1",
    scope: overrides.scope ?? "project",
    label: overrides.label ?? "test-node",
    content: overrides.content ?? "Some content here for testing",
    summary: overrides.summary ?? null,
    level: overrides.level ?? 0,
    parentIds: overrides.parentIds ?? null,
    embedding: overrides.embedding ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    importance: overrides.importance ?? 0.5,
    accessCount: overrides.accessCount ?? 0,
    lastAccessed: overrides.lastAccessed ?? null,
    type: overrides.type ?? null,
    metadata: overrides.metadata ?? null,
    sticky: overrides.sticky ?? false,
    confidence: overrides.confidence ?? 0,
    lastVerified: overrides.lastVerified ?? null,
    usefulnessScore: overrides.usefulnessScore ?? 0,
    timesUsed: overrides.timesUsed ?? 0,
    timesHelpful: overrides.timesHelpful ?? 0,
  };
}

function setupSqlite(scope: string = "project") {
  const db = new Database(":memory:");
  runMigrations(db);

  function insertDoc(overrides: { id?: string; content?: string; label?: string }) {
    const id = overrides.id ?? `doc-${Math.random().toString(36).slice(2, 8)}`;
    const content = overrides.content ?? "default content for BM25 testing";
    const label = overrides.label ?? "doc-label";
    updateBM25Index(db, id, content, label, scope);
    return id;
  }

  return { db, insertDoc };
}

describe("calculateDynamicBm25Weight", () => {
  test("returns base weight for empty query", () => {
    expect(calculateDynamicBm25Weight(0, 0.4)).toBe(0.4);
  });

  test("returns base weight for short query when base is lower", () => {
    const result = calculateDynamicBm25Weight(2, 0.4);
    const decay = Math.max(0.3, 0.6 - 0.002 * 2);
    expect(result).toBe(Math.min(0.4, decay));
    expect(result).toBeGreaterThan(0);
  });

  test("decays weight for long queries", () => {
    const result = calculateDynamicBm25Weight(200, 0.4);
    expect(result).toBeLessThan(0.4);
  });

  test("floors at 0.3", () => {
    const result = calculateDynamicBm25Weight(500, 0.4);
    expect(result).toBe(0.3);
  });

  test("caps at base weight", () => {
    const result = calculateDynamicBm25Weight(1, 0.2);
    expect(result).toBe(0.2);
  });
});

describe("detectCodeQuery", () => {
  test("detects backtick code blocks", () => {
    expect(detectCodeQuery("use `const x = 1`")).toBe(true);
  });

  test("detects file extensions", () => {
    expect(detectCodeQuery("open main.ts")).toBe(true);
  });

  test("detects function calls", () => {
    expect(detectCodeQuery("call foo()")).toBe(true);
  });

  test("detects file paths", () => {
    expect(detectCodeQuery("check src/foo/bar.ts")).toBe(true);
  });

  test("detects code keywords", () => {
    expect(detectCodeQuery("the function returns")).toBe(true);
    expect(detectCodeQuery("import lodash")).toBe(true);
    expect(detectCodeQuery("def foo")).toBe(true);
  });

  test("returns false for plain text", () => {
    expect(detectCodeQuery("what is the weather today?")).toBe(false);
    expect(detectCodeQuery("how does memory work")).toBe(false);
  });
});

describe("computeRecencyScore", () => {
  test("returns 0 for null lastAccessed", () => {
    expect(computeRecencyScore(null)).toBe(0);
  });

  test("returns ~1 for now", () => {
    const score = computeRecencyScore(new Date());
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1);
  });

  test("returns low score for old access", () => {
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const score = computeRecencyScore(old);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });
});

describe("computeBM25TermScore", () => {
  test("returns 0 when document frequency is 0", () => {
    const score = computeBM25TermScore({
      termFrequency: 5,
      documentFrequency: 0,
      documentLength: 100,
      averageDocumentLength: 50,
      totalDocuments: 10,
    });
    expect(score).toBe(0);
  });

  test("returns 0 when totalDocuments is 0", () => {
    const score = computeBM25TermScore({
      termFrequency: 5,
      documentFrequency: 3,
      documentLength: 100,
      averageDocumentLength: 50,
      totalDocuments: 0,
    });
    expect(score).toBe(0);
  });

  test("computes positive BM25 score", () => {
    const score = computeBM25TermScore({
      termFrequency: 3,
      documentFrequency: 2,
      documentLength: 100,
      averageDocumentLength: 50,
      totalDocuments: 10,
    });
    expect(score).toBeGreaterThan(0);
  });

  test("rare terms get higher score", () => {
    const common = computeBM25TermScore({
      termFrequency: 3, documentFrequency: 8, documentLength: 100, averageDocumentLength: 50, totalDocuments: 10,
    });
    const rare = computeBM25TermScore({
      termFrequency: 3, documentFrequency: 1, documentLength: 100, averageDocumentLength: 50, totalDocuments: 10,
    });
    expect(rare).toBeGreaterThan(common);
  });
});

describe("computeBM25Scores", () => {
  test("returns empty map for no query terms", () => {
    const scores = computeBM25Scores({ queryTerms: [], nodes: [makeNode()] });
    expect(scores.size).toBe(0);
  });

  test("returns empty map for no nodes", () => {
    const scores = computeBM25Scores({ queryTerms: ["hello"], nodes: [] });
    expect(scores.size).toBe(0);
  });

  test("scores nodes by BM25 relevance", () => {
    const matching = makeNode({ id: "match", content: "hello world hello world hello", label: "greeting" });
    const nonMatching = makeNode({ id: "no-match", content: "completely unrelated content here", label: "other" });
    const scores = computeBM25Scores({ queryTerms: ["hello", "world"], nodes: [matching, nonMatching] });
    expect(scores.get("match")).toBeGreaterThan(0);
    expect(scores.get("no-match")).toBe(0);
  });

  test("normalizes scores to [0,1] range", () => {
    const nodes = [
      makeNode({ id: "a", content: "hello world hello world", label: "x" }),
      makeNode({ id: "b", content: "hello", label: "y" }),
      makeNode({ id: "c", content: "unrelated content", label: "z" }),
    ];
    const scores = computeBM25Scores({ queryTerms: ["hello"], nodes });
    expect(scores.get("a")).toBeGreaterThanOrEqual(0);
    expect(scores.get("a")).toBeLessThanOrEqual(1);
    expect(scores.get("b")).toBeGreaterThan(0);
    expect(scores.get("b")).toBeLessThanOrEqual(1);
    expect(scores.get("c") ?? 0).toBe(0);
  });
});

describe("computeBM25ScoresSQL", () => {
  test("returns empty map for no query terms", () => {
    const { db } = setupSqlite();
    const scores = computeBM25ScoresSQL(db, "project", [], ["n1"]);
    expect(scores.size).toBe(0);
  });

  test("returns empty map for empty nodeIds", () => {
    const { db } = setupSqlite();
    const scores = computeBM25ScoresSQL(db, "project", ["hello"], []);
    expect(scores.size).toBe(0);
  });

  test("returns empty map when no docs exist in scope", () => {
    const { db } = setupSqlite("global");
    const scores = computeBM25ScoresSQL(db, "global", ["hello"], ["n1"]);
    expect(scores.size).toBe(0);
  });

  test("scores documents by BM25 using SQL indexes", () => {
    const { db, insertDoc } = setupSqlite("project");
    const matchId = insertDoc({ id: "match", content: "hello world hello", label: "greeting" });
    const noMatchId = insertDoc({ id: "no-match", content: "completely unrelated", label: "other" });

    const scores = computeBM25ScoresSQL(db, "project", ["hello", "world"], [matchId, noMatchId]);
    expect(scores.get(matchId)).toBeGreaterThan(0);
    expect(scores.get(noMatchId) ?? 0).toBe(0);
  });

  test("handles multiple docs with the same terms", () => {
    const { db, insertDoc } = setupSqlite("project");
    const a = insertDoc({ id: "a", content: "hello world", label: "x" });
    const b = insertDoc({ id: "b", content: "hello", label: "y" });
    const c = insertDoc({ id: "c", content: "unrelated content", label: "z" });

    const scores = computeBM25ScoresSQL(db, "project", ["hello"], [a, b, c]);
    expect(scores.get(a)).toBeGreaterThan(0);
    expect(scores.get(b)).toBeGreaterThan(0);
  });

  test("normalizes scores to [0,1]", () => {
    const { db, insertDoc } = setupSqlite("project");
    const a = insertDoc({ id: "a", content: "hello world", label: "a" });
    const b = insertDoc({ id: "b", content: "hello", label: "b" });

    const scores = computeBM25ScoresSQL(db, "project", ["hello"], [a, b]);
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("updateBM25Index and removeBM25Index", () => {
  test("updateBM25Index populates bm25_index and bm25_doc_stats", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    updateBM25Index(db, "n1", "hello world", "label1", "project");

    const stats = db.query("SELECT token_count FROM bm25_doc_stats WHERE node_id = ?").get("n1") as { token_count: number } | null;
    expect(stats).not.toBeNull();
    expect(stats!.token_count).toBeGreaterThan(0);

    const terms = db.query("SELECT term, frequency FROM bm25_index WHERE node_id = ? ORDER BY term").all("n1") as { term: string; frequency: number }[];
    expect(terms.length).toBeGreaterThan(0);
  });

  test("removeBM25Index deletes index entries", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    updateBM25Index(db, "n1", "hello world", "label1", "project");
    removeBM25Index(db, "n1");

    const stats = db.query("SELECT COUNT(*) as c FROM bm25_doc_stats WHERE node_id = ?").get("n1") as { c: number };
    expect(stats.c).toBe(0);
    const terms = db.query("SELECT COUNT(*) as c FROM bm25_index WHERE node_id = ?").get("n1") as { c: number };
    expect(terms.c).toBe(0);
  });

  test("updateBM25Index replaces old entries on re-index", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    updateBM25Index(db, "n1", "hello world", "label1", "project");
    updateBM25Index(db, "n1", "new content only", "label1", "project");

    const stats = db.query("SELECT token_count FROM bm25_doc_stats WHERE node_id = ?").get("n1") as { token_count: number } | null;
    // Tokens: ["new", "content", "only", "label1"] = 4
    expect(stats!.token_count).toBe(4);

    const terms = db.query("SELECT term FROM bm25_index WHERE node_id = ?").all("n1") as { term: string }[];
    expect(terms.find(t => t.term === "hello")).toBeUndefined();
    expect(terms.find(t => t.term === "new")).toBeDefined();
  });
});

describe("computeFinalScores", () => {
  test("returns nodes with importance from semantic score when no BM25", () => {
    const nodes = [makeNode({ id: "a", importance: 0.8 })];
    const result = computeFinalScores(nodes, { bm25Weight: 0, queryText: "" });
    expect(result).toHaveLength(1);
    expect(result[0]!.importance).toBeGreaterThan(0);
  });

  test("blends BM25 and semantic scores", () => {
    const nodes = [makeNode({ id: "a", importance: 0.8, content: "hello world hello", lastAccessed: new Date() })];
    const options = { bm25Weight: 0.4, queryText: "hello world", bm25Scores: new Map([["a", 0.9]]) };
    const result = computeFinalScores(nodes, options);
    expect(result[0]!.importance).toBeGreaterThan(0);
    // Semantic 0.8 * 0.6 + BM25 0.9 * 0.4 = 0.48 + 0.36 = 0.84, then * recency boost
    expect(result[0]!.importance).toBeCloseTo(0.84 * (1 + computeRecencyScore(nodes[0]!.lastAccessed) * 0.2), 5);
  });

  test("boosts BM25 weight for code queries", () => {
    const nodes = [makeNode({ id: "a", importance: 0.5, content: "function foo() { return bar; }", lastAccessed: new Date() })];
    const options = { bm25Weight: 0.3, queryText: "function foo()", bm25Scores: new Map([["a", 1.0]]) };
    const result = computeFinalScores(nodes, options);
    // Code queries get min(0.3, 0.7) = 0.3 (since detectCodeQuery overrides to >= 0.7)
    // Actually: code query -> dynamicBm25Weight = max(0.3, 0.7) = 0.7
    // So semantic = 0.5 * 0.3 + 1.0 * 0.7 = 0.85, then * recency boost
    expect(result[0]!.importance).toBeGreaterThan(0.5);
  });

  test("applies recency boost", () => {
    const fresh = makeNode({ id: "fresh", importance: 0.5, lastAccessed: new Date(), content: "same" });
    const old = makeNode({ id: "old", importance: 0.5, lastAccessed: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), content: "same" });
    const freshResult = computeFinalScores([fresh], { bm25Weight: 0, queryText: "" });
    const oldResult = computeFinalScores([old], { bm25Weight: 0, queryText: "" });
    expect(freshResult[0]!.importance).toBeGreaterThan(oldResult[0]!.importance);
  });
});

describe("rerankResults", () => {
  test("returns original scores when fewer nodes than topK", () => {
    const nodes = [makeNode({ id: "a", importance: 0.5 }), makeNode({ id: "b", importance: 0.3 })];
    const result = rerankResults("hello", nodes, 10);
    expect(result).toHaveLength(2);
    expect(result[0]!.node.id).toBe("a");
    expect(result[0]!.rerankScore).toBe(1);
    expect(result[0]!.finalScore).toBe(0.5);
  });

  test("boosts nodes matching query terms", () => {
    const matching = makeNode({ id: "match", importance: 0.3, content: "hello world hello here", label: "hello" });
    const nonMatching = makeNode({ id: "no-match", importance: 0.5, content: "completely unrelated text content provided", label: "other" });
    const extras = Array.from({ length: 10 }, (_, i) =>
      makeNode({ id: `extra-${i}`, importance: 0.1, content: "filler content", label: "filler" })
    );
    const nodes = [matching, nonMatching, ...extras];
    const result = rerankResults("hello world", nodes, 5);
    expect(result[0]!.node.id).toBe("match");
  });

  test("returns topK results", () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode({ id: `n-${i}`, importance: 0.5, content: `item ${i}`, label: `item-${i}` })
    );
    const result = rerankResults("test", nodes, 5);
    expect(result).toHaveLength(5);
  });
});
