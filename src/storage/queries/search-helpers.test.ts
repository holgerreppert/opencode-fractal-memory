import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations";
import type { MemoryNode } from "../types";
import {
  computeRecencyScore,
  computeBM25TermScore,
  computeBM25Scores,
  computeBM25ScoresSQL,
  computeQualityMultiplier,
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

describe("computeQualityMultiplier", () => {
  test("storedcontext session dumps are demoted below generic nodes", () => {
    const generic = computeQualityMultiplier(makeNode({ id: "g", type: "concept", label: "generic" }));
    const stored = computeQualityMultiplier(makeNode({ id: "s", type: "storedcontext", label: "sess-x" }));
    expect(stored).toBeLessThan(generic);
    expect(stored).toBe(0.5);
  });

  test("curated knowledge/rule labels are boosted above generic", () => {
    const generic = computeQualityMultiplier(makeNode({ id: "g", type: "concept", label: "generic" }));
    const knowledge = computeQualityMultiplier(makeNode({ id: "k", type: "concept", label: "knowledge:foo" }));
    const rule = computeQualityMultiplier(makeNode({ id: "r", type: "concept", label: "rule:mandatory:x" }));
    expect(knowledge).toBeGreaterThan(generic);
    expect(rule).toBeGreaterThan(generic);
    expect(knowledge).toBe(1.25);
    expect(rule).toBe(1.25);
  });

  test("middle-term snapshots are demoted like storedcontext", () => {
    const generic = computeQualityMultiplier(makeNode({ id: "g", type: "concept", label: "generic" }));
    const middleTerm = computeQualityMultiplier(makeNode({ id: "m", type: "concept", label: "middle-term:ses-x" }));
    expect(middleTerm).toBeLessThan(generic);
    expect(middleTerm).toBe(0.6);
  });

  test("purpose-centric lesson/decision/convention/fact labels are boosted hardest", () => {
    const base = computeQualityMultiplier(makeNode({ id: "g", type: "concept", label: "generic" }));
    const lessonScore = computeQualityMultiplier(makeNode({ id: "l", type: "lesson", label: "lesson:z" }));
    const decisionScore = computeQualityMultiplier(makeNode({ id: "d", type: "decision", label: "decision:use-bun" }));
    expect(lessonScore).toBeGreaterThan(base);
    expect(decisionScore).toBeGreaterThan(base);
    expect(lessonScore).toBe(1.3);
    expect(decisionScore).toBe(1.3);
  });
});
