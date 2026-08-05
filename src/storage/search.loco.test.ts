import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSqliteMemoryStore } from "../storage/sqlite";
import type { MemoryStore, MemoryNode } from "../storage/types";
import { CATEGORY_LABELS } from "../../scripts/benchmark/datasets/locomo";
import { seedLocomoDatabase, LOCOMO_PROJECT_NAME } from "../../scripts/benchmark/seed-locomo";

const KS = [3, 5, 10];

type QaEmbeddingEntry = {
  conversation: string;
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

describe("LoCoMo retrieval quality", () => {
  let store: MemoryStore;
  let qaEntries: QaEmbeddingEntry[];
  let dbDir: string;
  let byCategory: Map<number, { entries: QaEmbeddingEntry[]; label: string }>;

  beforeAll(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "locomo-seed-"));
    const start = Date.now();
    const result = await seedLocomoDatabase(dbDir);
    console.log(`\n  Seeded LoCoMo DB in ${((Date.now() - start) / 1000).toFixed(1)}s: ${result.turns} turns, ${result.qas} QAs`);

    store = createSqliteMemoryStore(dbDir, result.dbPath);

    const raw = JSON.parse(fs.readFileSync(result.qaPath, "utf-8"));
    qaEntries = raw as QaEmbeddingEntry[];

    byCategory = new Map();
    for (const entry of qaEntries) {
      const cat = entry.category;
      if (!byCategory.has(cat)) {
        byCategory.set(cat, { entries: [], label: CATEGORY_LABELS[cat] ?? `cat_${cat}` });
      }
      byCategory.get(cat)!.entries.push(entry);
    }

    console.log(`  Total QA pairs: ${qaEntries.length}`);
    console.log(`  Categories: ${[...byCategory.entries()].map(([k, v]) => `${v.label}=${v.entries.length}`).join(", ")}\n`);
  });

  afterAll(async () => {
    await store?.close();
    if (dbDir) {
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
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
        const evidenceLabels = new Set(entry.evidence.map(e => `${entry.conversation}-${e}`));
        if (evidenceLabels.size === 0) continue;

        const retrieved = await store.searchByEmbedding(entry.embedding, 10, {
          queryText: entry.question,
          rerank: true,
          temporalHops: 2,
          projectName: LOCOMO_PROJECT_NAME,
        });

        for (const k of KS) {
          const metrics = computeMetrics(evidenceLabels, retrieved, k);
          const acc = byK.get(k)!;
          acc.hitRates.push(metrics.hitRate);
          acc.recalls.push(metrics.recall);
          acc.precisions.push(metrics.precision);
          acc.mrrs.push(metrics.mrr);
        }

        done++;
        if (done % 200 === 0) {
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

    const all5 = results.get(1)?.get(5);
    if (all5) {
      expect(all5.hitRate).toBeGreaterThan(0);
    }
    const adv5 = results.get(5)?.get(5);
    if (adv5) {
      expect(adv5.hitRate).toBeLessThan(0.5);
    }

    expect(results.size).toBeGreaterThanOrEqual(4);
  });
});
