import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSqliteMemoryStore } from "../storage/sqlite";
import type { MemoryStore, MemoryNode } from "../storage/types";
import { CATEGORY_LABELS } from "../../scripts/benchmark/datasets/synthetic";

const DB_DIR = path.resolve(__dirname, "../../tests/dbs/synthetic-seeded");
const DB_PATH = path.join(DB_DIR, "memory.db");
const QA_PATH = path.join(DB_DIR, "qa-embeddings.json");
const KS = [3, 5, 10];

type QaEmbeddingEntry = {
  question: string;
  evidence: string[];
  category: number;
  embedding: number[];
};

type CategoryMetrics = {
  count: number;
  hitRate: number;
  recall: number;
  precision: number;
  mrr: number;
};

function computeMetrics(
  evidenceLabels: Set<string>,
  retrieved: MemoryNode[],
  K: number,
): { hitRate: number; recall: number; precision: number; mrr: number } {
  const topK = retrieved.slice(0, K);
  const hits = topK.filter(n => n.label && evidenceLabels.has(n.label));
  const firstRelevant = topK.findIndex(n => n.label && evidenceLabels.has(n.label));

  const hitRate = hits.length > 0 ? 1 : 0;
  const precision = K > 0 ? hits.length / K : 0;
  const recall = evidenceLabels.size > 0 ? hits.length / evidenceLabels.size : 0;
  const mrr = firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0;

  return { hitRate, recall, precision, mrr };
}

function formatPct(v: number): string {
  return (v * 100).toFixed(1);
}

describe("Synthetic retrieval quality", () => {
  const hasDb = fs.existsSync(DB_PATH) && fs.existsSync(QA_PATH);

  test("pre-seeded database exists", () => {
    if (!hasDb) {
      console.warn(`\n  Pre-seeded database not found at ${DB_PATH}`);
      console.warn(`  Run: bun run scripts/seed-synthetic-db.ts`);
    }
    expect(hasDb).toBe(true);
  });

  if (!hasDb) return;

  let store: MemoryStore;
  let qaEntries: QaEmbeddingEntry[];
  let totalQAs: number;
  let byCategory: Map<number, { entries: QaEmbeddingEntry[]; label: string }>;

  test("load pre-seeded database and QA embeddings", async () => {
    store = createSqliteMemoryStore(DB_DIR, DB_PATH);
    await store.rebuildHNSWIndex("project");

    const raw = JSON.parse(fs.readFileSync(QA_PATH, "utf-8"));
    qaEntries = raw as QaEmbeddingEntry[];
    totalQAs = qaEntries.length;

    byCategory = new Map();
    for (const entry of qaEntries) {
      const cat = entry.category;
      if (!byCategory.has(cat)) {
        byCategory.set(cat, { entries: [], label: CATEGORY_LABELS[cat] ?? `cat_${cat}` });
      }
      byCategory.get(cat)!.entries.push(entry);
    }

    console.log(`\n  Database: ${DB_PATH}`);
    console.log(`  Total QA pairs: ${totalQAs}`);
    console.log(`  Categories: ${[...byCategory.entries()].map(([k, v]) => `${v.label}=${v.entries.length}`).join(", ")}\n`);
  });

  test("run retrieval and compute metrics", async () => {
    const results = new Map<number, Map<number, CategoryMetrics>>();

    for (const [cat, info] of byCategory) {
      const byK = new Map<number, { hitRates: number[]; recalls: number[]; precisions: number[]; mrrs: number[] }>();
      for (const k of KS) {
        byK.set(k, { hitRates: [], recalls: [], precisions: [], mrrs: [] });
      }

      let done = 0;
      for (const entry of info.entries) {
        const evidenceLabels = new Set(entry.evidence);
        if (evidenceLabels.size === 0 && entry.category !== 6) continue;
        if (evidenceLabels.size === 0) {
          const retrieved = await store.searchByEmbedding(entry.embedding, 10, {
            bm25Weight: 0.4,
            queryText: entry.question,
            rerank: true,
            temporalHops: 2,
          } as any);
          for (const k of KS) {
            const metrics = computeMetrics(evidenceLabels, retrieved, k);
            const acc = byK.get(k)!;
            acc.hitRates.push(metrics.hitRate);
            acc.recalls.push(metrics.recall);
            acc.precisions.push(metrics.precision);
            acc.mrrs.push(metrics.mrr);
          }
          done++;
          continue;
        }

        const retrieved = await store.searchByEmbedding(entry.embedding, 10, {
          bm25Weight: 0.4,
          queryText: entry.question,
          rerank: true,
          temporalHops: 2,
        } as any);

        for (const k of KS) {
          const metrics = computeMetrics(evidenceLabels, retrieved, k);
          const acc = byK.get(k)!;
          acc.hitRates.push(metrics.hitRate);
          acc.recalls.push(metrics.recall);
          acc.precisions.push(metrics.precision);
          acc.mrrs.push(metrics.mrr);
        }

        done++;
        if (done % 25 === 0) {
          console.log(`    ${info.label}: ${done}/${info.entries.length}...`);
        }
      }

      const catResults = new Map<number, CategoryMetrics>();
      for (const k of KS) {
        const acc = byK.get(k)!;
        const n = acc.hitRates.length;
        catResults.set(k, {
          count: n,
          hitRate: n > 0 ? acc.hitRates.reduce((a, b) => a + b, 0) / n : 0,
          recall: n > 0 ? acc.recalls.reduce((a, b) => a + b, 0) / n : 0,
          precision: n > 0 ? acc.precisions.reduce((a, b) => a + b, 0) / n : 0,
          mrr: n > 0 ? acc.mrrs.reduce((a, b) => a + b, 0) / n : 0,
        });
      }
      results.set(cat, catResults);
    }

    const header = `${"Category".padEnd(16)} | K | HitRate  | Recall   | Prec.    | MRR`;
    const sep = `-`.repeat(header.length);
    console.log(`  ${sep}`);
    console.log(`  ${header}`);
    console.log(`  ${sep}`);
    for (const [cat, byK] of results) {
      const label = CATEGORY_LABELS[cat] ?? `cat_${cat}`;
      for (const k of KS) {
        const m = byK.get(k)!;
        const line = `${label.padEnd(16)} | ${k} | ${formatPct(m.hitRate).padStart(5)}%  | ${formatPct(m.recall).padStart(5)}%  | ${formatPct(m.precision).padStart(5)}%  | ${formatPct(m.mrr).padStart(5)}%`;
        console.log(`  ${line}`);
      }
    }
    console.log(`  ${sep}\n`);

    for (const cat of results.keys()) {
      const catRes = results.get(cat)!;
      expect(catRes.has(3)).toBe(true);
    }

    expect(results.size).toBeGreaterThanOrEqual(5);
  });
});
