import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSqliteMemoryStore } from "../storage/sqlite";
import type { MemoryStore, MemoryNode } from "../storage/types";
import { labelForExperience, loadRelationshipLinks } from "../../scripts/benchmark/datasets/swe-context";
import { seedSweContextDatabase, SWE_CONTEXT_PROJECT_NAME } from "../../scripts/benchmark/seed-swe-context";

const KS = [3, 5, 10];

type RelatedEmbeddingEntry = {
  instance_id: string;
  repo: string;
  problem_statement: string;
  base_commit: string;
  embedding: number[];
};

type Metrics = {
  count: number;
  hitRate: number;
  recall: number;
  precision: number;
  mrr: number;
};

type PerRepo = Map<string, Map<number, Metrics>>;

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

function summarize(perRepo: PerRepo): { totalN: number; overallHit5: number; overallHit10: number } {
  const header = `${"Repo".padEnd(20)} | K | HitRate  | Recall   | Prec.    | MRR`;
  const sep = `-`.repeat(header.length);
  console.log(`  ${sep}`);
  console.log(`  ${header}`);
  console.log(`  ${sep}`);
  for (const [repo, byK] of perRepo) {
    for (const k of KS) {
      const m = byK.get(k)!;
      const line = `${repo.padEnd(20)} | ${k} | ${formatPct(m.hitRate).padStart(5)}%  | ${formatPct(m.recall).padStart(5)}%  | ${formatPct(m.precision).padStart(5)}%  | ${formatPct(m.mrr).padStart(5)}%`;
      console.log(`  ${line}`);
    }
  }
  console.log(`  ${sep}\n`);

  let totalHit5 = 0;
  let totalHit10 = 0;
  let totalN = 0;
  for (const byK of perRepo.values()) {
    totalHit5 += byK.get(5)!.hitRate * byK.get(5)!.count;
    totalHit10 += byK.get(10)!.hitRate * byK.get(10)!.count;
    totalN += byK.get(5)!.count;
  }
  const overallHit5 = totalN > 0 ? totalHit5 / totalN : 0;
  const overallHit10 = totalN > 0 ? totalHit10 / totalN : 0;
  return { totalN, overallHit5, overallHit10 };
}

describe("SWE-ContextBench retrieval quality", () => {
  let store: MemoryStore;
  let relatedEntries: RelatedEmbeddingEntry[];
  let byRepo: Map<string, RelatedEmbeddingEntry[]>;
  let dbDir: string;
  let relationship: Map<string, Set<string>>;

  beforeAll(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "swe-context-seed-"));
    const start = Date.now();
    const result = await seedSweContextDatabase(dbDir);
    console.log(`\n  Seeded SWE-ContextBench DB in ${((Date.now() - start) / 1000).toFixed(1)}s: ${result.experiences} experiences, ${result.related} related tasks`);

    store = createSqliteMemoryStore(dbDir, result.dbPath);

    const raw = JSON.parse(fs.readFileSync(path.join(dbDir, "related-embeddings-gte-small.json"), "utf-8"));
    relatedEntries = raw as RelatedEmbeddingEntry[];

    relationship = new Map();
    for (const link of loadRelationshipLinks()) {
      relationship.set(link.related_instance_id, new Set(link.experience_instance_ids.map(labelForExperience)));
    }
    const linkedRelated = relatedEntries.filter(r => relationship.has(r.instance_id));
    console.log(`  Related tasks with ground-truth links: ${linkedRelated.length}/${relatedEntries.length}\n`);

    byRepo = new Map();
    for (const entry of relatedEntries) {
      if (!byRepo.has(entry.repo)) {
        byRepo.set(entry.repo, []);
      }
      byRepo.get(entry.repo)!.push(entry);
    }
  });

  afterAll(async () => {
    await store?.close();
    if (dbDir) {
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });

  const runMode = async (mode: "keyword" | "cross-encoder"): Promise<PerRepo> => {
    const perRepo = new Map<string, Map<number, Metrics>>();

    for (const [repo, entries] of byRepo) {
      const byK = new Map<number, { hitRates: number[]; recalls: number[]; precisions: number[]; mrrs: number[] }>();
      for (const k of KS) {
        byK.set(k, { hitRates: [], recalls: [], precisions: [], mrrs: [] });
      }

      for (const entry of entries) {
        const evidenceLabels = relationship.get(entry.instance_id);
        if (!evidenceLabels || evidenceLabels.size === 0) continue;

        const retrieved = await store.searchByEmbedding(entry.embedding, 10, {
          queryText: entry.problem_statement,
          rerank: true,
          rerankMode: mode,
          temporalHops: 1,
          projectName: SWE_CONTEXT_PROJECT_NAME,
        });

        for (const k of KS) {
          const metrics = computeMetrics(evidenceLabels, retrieved, k);
          const acc = byK.get(k)!;
          acc.hitRates.push(metrics.hitRate);
          acc.recalls.push(metrics.recall);
          acc.precisions.push(metrics.precision);
          acc.mrrs.push(metrics.mrr);
        }
      }

      const repoResults = new Map<number, Metrics>();
      for (const k of KS) {
        const acc = byK.get(k)!;
        const n = acc.hitRates.length;
        repoResults.set(k, {
          count: n,
          hitRate: n > 0 ? acc.hitRates.reduce((a, b) => a + b, 0) / n : 0,
          recall: n > 0 ? acc.recalls.reduce((a, b) => a + b, 0) / n : 0,
          precision: n > 0 ? acc.precisions.reduce((a, b) => a + b, 0) / n : 0,
          mrr: n > 0 ? acc.mrrs.reduce((a, b) => a + b, 0) / n : 0,
        });
      }
      perRepo.set(repo, repoResults);
    }
    return perRepo;
  };

  test("cross-encoder rerank beats keyword baseline on HitRate@10", async () => {
    console.log(`\n=== Rerank mode: keyword (baseline) ===`);
    const kwPerRepo = await runMode("keyword");
    const kw = summarize(kwPerRepo);
    console.log(`  keyword Overall HitRate@5: ${formatPct(kw.overallHit5)}%  HitRate@10: ${formatPct(kw.overallHit10)}% (${kw.totalN} queries)\n`);

    console.log(`\n=== Rerank mode: cross-encoder ===`);
    const cePerRepo = await runMode("cross-encoder");
    const ce = summarize(cePerRepo);
    console.log(`  cross-encoder Overall HitRate@5: ${formatPct(ce.overallHit5)}%  HitRate@10: ${formatPct(ce.overallHit10)}% (${ce.totalN} queries)\n`);

    expect(kwPerRepo.size).toBeGreaterThanOrEqual(4);
    expect(kw.totalN).toBeGreaterThanOrEqual(50);
    expect(kw.overallHit5).toBeGreaterThan(0);
    // The feature-weighted linear model already ranks strongly on precision
    // (@5): keyword beats cross-encoder there. The cross-encoder's value is
    // recall — it surfaces more relevant items inside the top-10.
    expect(ce.overallHit10).toBeGreaterThan(kw.overallHit10);
  }, 480000);
});
