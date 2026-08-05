import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations";
import type { MemoryNode } from "../types";
import {
  computeRecencyScore,
  computeBM25TermScore,
  computeBM25Scores,
  computeBM25ScoresSQL,
  computeRRFScores,
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

describe("computeRecencyScore", () => {
  test("returns neutral 1.0 for null lastAccessed (unknown recency)", () => {
    expect(computeRecencyScore(null)).toBe(1.0);
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

describe("computeRRFScores", () => {
  test("normalizes single candidate to 1.0", () => {
    const nodes = [makeNode({ id: "a", importance: 0.8, lastAccessed: null })];
    const result = computeRRFScores(nodes, { queryText: "" });
    expect(result).toHaveLength(1);
    expect(result[0]!.importance).toBeCloseTo(1.0, 6);
  });

  test("top-ranked candidate normalizes to 1.0, bottom to 0", () => {
    const nodes = [
      makeNode({ id: "a", importance: 0.9, lastAccessed: null }),
      makeNode({ id: "b", importance: 0.8, lastAccessed: null }),
    ];
    const result = computeRRFScores(nodes, { queryText: "hello", bm25Scores: new Map([["b", 1.0]]) });
    expect(result.find(n => n.id === "b")!.importance).toBeCloseTo(1.0, 6);
    expect(result.find(n => n.id === "a")!.importance).toBeCloseTo(0.0, 6);
    expect(result.find(n => n.id === "b")!.importance).toBeGreaterThan(result.find(n => n.id === "a")!.importance);
  });

  test("both-legs node beats rank-1-in-one-leg node", () => {
    const nodes = [
      makeNode({ id: "a", importance: 0.9, lastAccessed: null }),
      makeNode({ id: "b", importance: 0.8, lastAccessed: null }),
      makeNode({ id: "c", importance: 0.7, lastAccessed: null }),
    ];
    // b and c each in both legs; a only in semantic leg (no BM25 score)
    const result = computeRRFScores(nodes, {
      queryText: "hello",
      bm25Scores: new Map([["b", 1.0], ["c", 0.9]]),
    });
    const a = result.find(n => n.id === "a")!.importance;
    const b = result.find(n => n.id === "b")!.importance;
    const c = result.find(n => n.id === "c")!.importance;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(c);
    expect(b).toBeCloseTo(1.0, 6);
  });

  test("applies multiplicative recency penalty", () => {
    const fresh = makeNode({ id: "fresh", importance: 0.5, lastAccessed: new Date(), content: "same" });
    const old = makeNode({ id: "old", importance: 0.5, lastAccessed: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), content: "same" });
    const freshResult = computeRRFScores([fresh], { queryText: "" });
    const oldResult = computeRRFScores([old], { queryText: "" });
    // Fresh node keeps ~full normalized score (recencyScore=1 → 0.3+0.7=1.0);
    // stale node is demoted to the 0.3 floor — NOT merely left at 1.0.
    expect(freshResult[0]!.importance).toBeGreaterThan(oldResult[0]!.importance);
    expect(freshResult[0]!.importance).toBeCloseTo(1.0, 6);
    expect(oldResult[0]!.importance).toBeCloseTo(0.3, 6);
  });

  test("applies type/label quality multiplier", () => {
    const mk = (id: string, type?: string, label?: string) =>
      makeNode({ id, importance: 0.5, lastAccessed: null, type: type as MemoryNode["type"], label: label ?? id });
    const generic = computeRRFScores([mk("g")], { queryText: "" })[0]!.importance;
    const stored = computeRRFScores([mk("s", "storedcontext")], { queryText: "" })[0]!.importance;
    const knowledge = computeRRFScores([mk("k", "concept", "knowledge:foo")], { queryText: "" })[0]!.importance;
    const rule = computeRRFScores([mk("r", "concept", "rule:mandatory:x")], { queryText: "" })[0]!.importance;
    const middleTerm = computeRRFScores([mk("m", "concept", "middle-term:ses-x")], { queryText: "" })[0]!.importance;
    // storedcontext session dumps are demoted below generic nodes
    expect(stored).toBeLessThan(generic);
    // curated knowledge/rule labels are boosted above generic
    expect(knowledge).toBeGreaterThan(generic);
    expect(rule).toBeGreaterThan(generic);
    // middle-term snapshots are demoted like storedcontext
    expect(middleTerm).toBeLessThan(generic);
  });

  test("purpose-centric lesson/decision/convention/fact labels are boosted hardest", () => {
    const base = computeRRFScores([makeNode({ id: "g", importance: 0.5, lastAccessed: null, label: "generic" })], { queryText: "" })[0]!.importance;
    const lessonScore = computeRRFScores([makeNode({ id: "l", importance: 0.5, lastAccessed: null, label: "lesson:z" })], { queryText: "" })[0]!.importance;
    const decisionScore = computeRRFScores([makeNode({ id: "d", importance: 0.5, lastAccessed: null, label: "decision:use-bun" })], { queryText: "" })[0]!.importance;
    // purpose labels (×1.3) strictly beat generic (×1.0)
    expect(lessonScore).toBeGreaterThan(base);
    expect(decisionScore).toBeGreaterThan(base);
    expect(lessonScore).toBeCloseTo(1.3, 6);
  });

  test("level>=1 nodes decay from createdAt, not lastAccessed", () => {
    // Stale summary: created 30 days ago, but lastAccessed refreshed to now
    // (simulating the searchByEmbedding re-stamp loop). With createdAt decay
    // the recency penalty collapses to the 0.3 floor despite the fresh
    // lastAccessed.
    const staleSummary = makeNode({
      id: "stale-summary",
      importance: 0.5,
      level: 1,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lastAccessed: new Date(),
      content: "same",
    });
    const freshSummary = makeNode({
      id: "fresh-summary",
      importance: 0.5,
      level: 1,
      createdAt: new Date(),
      lastAccessed: new Date(),
      content: "same",
    });
    const staleResult = computeRRFScores([staleSummary], { queryText: "" });
    const freshResult = computeRRFScores([freshSummary], { queryText: "" });
    // Single-candidate sets normalize to 1.0; recency penalty is the separator
    expect(staleResult[0]!.importance).toBeCloseTo(0.3, 6);
    expect(freshResult[0]!.importance).toBeCloseTo(1.0, 6);
    expect(freshResult[0]!.importance).toBeGreaterThan(staleResult[0]!.importance);
  });

  test("higher k flattens score spread between ranks", () => {
    const mk = (id: string, imp: number) => makeNode({ id, importance: imp, lastAccessed: null });
    const nodes = [mk("r1", 0.9), mk("r2", 0.8), mk("r3", 0.7)];
    const scores60 = computeRRFScores(nodes, {
      queryText: "hello",
      rrfK: 60,
      bm25Scores: new Map([["r1", 1.0], ["r2", 0.9], ["r3", 0.8]]),
    });
    const scores10 = computeRRFScores(nodes, {
      queryText: "hello",
      rrfK: 10,
      bm25Scores: new Map([["r1", 1.0], ["r2", 0.9], ["r3", 0.8]]),
    });
    // Higher k gives the middle rank a higher normalized share
    const mid60 = scores60.find(n => n.id === "r2")!.importance;
    const mid10 = scores10.find(n => n.id === "r2")!.importance;
    expect(mid60).toBeGreaterThan(mid10);
    // Top rank always normalizes to 1.0 regardless of k
    expect(scores60.find(n => n.id === "r1")!.importance).toBeCloseTo(1.0, 6);
    expect(scores10.find(n => n.id === "r1")!.importance).toBeCloseTo(1.0, 6);
  });

  test("empty input returns empty array", () => {
    const result = computeRRFScores([], { queryText: "" });
    expect(result).toEqual([]);
  });

  test("null/undefined importance does not crash and ranks bottom", () => {
    const nodes = [
      makeNode({ id: "high", importance: 0.9, lastAccessed: null }),
      makeNode({ id: "null-imp", importance: null as unknown as number, lastAccessed: null }),
      makeNode({ id: "undef-imp", importance: undefined as unknown as number, lastAccessed: null }),
    ];
    const result = computeRRFScores(nodes, { queryText: "" });
    expect(result).toHaveLength(3);
    // Ties in importance sort stably; both bottom nodes get distinct ranks
    expect(result[0]!.id).toBe("high");
    expect(Number.isFinite(result[1]!.importance)).toBe(true);
    expect(Number.isFinite(result[2]!.importance)).toBe(true);
  });

  test("k=0 and negative k are clamped to 1, no NaN", () => {
    const nodes = [
      makeNode({ id: "a", importance: 0.9, lastAccessed: null }),
      makeNode({ id: "b", importance: 0.8, lastAccessed: null }),
    ];
    const bm25 = new Map([["a", 1.0], ["b", 0.5]]);
    for (const badK of [0, -5, -60]) {
      const result = computeRRFScores(nodes, { queryText: "hello", rrfK: badK, bm25Scores: bm25 });
      expect(result).toHaveLength(2);
      expect(result.every(n => Number.isFinite(n.importance))).toBe(true);
      expect(result[0]!.id).toBe("a");
      expect(result[0]!.importance).toBeCloseTo(1.0, 6);
    }
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
