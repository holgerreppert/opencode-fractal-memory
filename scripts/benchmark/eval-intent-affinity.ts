import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { createSqliteMemoryStore } from "../../src/storage/sqlite";
import type { SearchResult } from "../../src/domain/ports/SearchStore";
import { classifyIntent, INTENT_ORDER } from "../../src/application/ranking/intent-dist";
import type { TaskIntent } from "../../src/storage/types";
import { labelForExperience, loadExperienceTasks, loadRelationshipLinks } from "./datasets/swe-context";
import { contentForExperience, seedSweContextDatabase, SWE_CONTEXT_PROJECT_NAME } from "./seed-swe-context";

/**
 * SWE-ContextBench A/B for the intent usefulness-vector ranking feature
 * (P3/P4 of the intent usefulness-vector plan).
 *
 * Vector simulation has NO ground-truth leakage: each experience node's
 * intentVector is seeded from classifyIntent(its OWN content) scores — the
 * same information P2 attribution would accumulate from real usage. Each
 * query passes the argmax intent of its own problem statement as task_intent
 * (what an agent would declare at search time).
 *
 * Conditions:
 *   baseline   — featureWeights.intent = 0 (production default, gate off)
 *   intent-on  — featureWeights.intent = W, congruent query intent
 *   shuffled   — same W, but each query gets the NEXT query's intent
 *                (marginal intent distribution preserved, congruence broken)
 *
 * intent-on ≫ baseline ≈ shuffled would show the feature carries real signal;
 * intent-on ≈ baseline ≈ shuffled means intent congruence adds nothing here.
 */

const WEIGHT = Number(process.argv[2] ?? "0.15");
const MAX_QUERIES = Number(process.argv[3] ?? "0"); // 0 = all linked queries
const KS = [3, 5, 10] as const;

type Entry = {
  instance_id: string;
  repo: string;
  problem_statement: string;
  embedding: number[];
};

type CondMetrics = { hit: Record<number, number[]>; mrr: number[] };

function pct(v: number): string {
  return (v * 100).toFixed(1);
}

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "swe-intent-ab-"));
console.log("Seeding SWE-ContextBench DB (committed embedding caches, no ONNX)...");
const result = await seedSweContextDatabase(dbDir);

// Seed per-node intent vectors from each experience's OWN content — simulates
// what P2 attribution accumulates, without touching ground-truth links.
const experiences = loadExperienceTasks().filter(e => e.instance_id);
const seedDb = new Database(result.dbPath);
const upd = seedDb.prepare("UPDATE memory_nodes SET metadata = ? WHERE label = ?");
const intentCounts = {} as Record<string, number>;
for (const exp of experiences) {
  const scores = classifyIntent(contentForExperience(exp)).scores;
  upd.run(JSON.stringify({ intentVector: scores }), labelForExperience(exp.instance_id));
  const top = INTENT_ORDER.reduce((a, b) => (scores[b] > scores[a] ? b : a));
  intentCounts[top] = (intentCounts[top] ?? 0) + 1;
}
seedDb.close();
console.log(`  Seeded intent vectors on ${experiences.length} experience nodes`);
console.log(`  Node argmax intent distribution: ${Object.entries(intentCounts).map(([k, v]) => `${k}=${v}`).join(" ")}\n`);

const store = createSqliteMemoryStore(dbDir, result.dbPath);

const links = loadRelationshipLinks();
const byRelated = new Map(links.map(l => [l.related_instance_id, l.experience_instance_ids.map(labelForExperience)]));
const allEntries = JSON.parse(
  fs.readFileSync(path.join(dbDir, "related-embeddings-gte-small.json"), "utf-8"),
) as Entry[];
const entries = allEntries
  .filter(e => (byRelated.get(e.instance_id) ?? []).length > 0)
  .slice(0, MAX_QUERIES > 0 ? MAX_QUERIES : undefined);

const queryIntents = entries.map(e => classifyIntent(e.problem_statement).intent);
const qCounts: Record<string, number> = {};
for (const i of queryIntents) qCounts[i] = (qCounts[i] ?? 0) + 1;
console.log(`${entries.length} linked queries`);
console.log(`Query argmax intent distribution: ${Object.entries(qCounts).map(([k, v]) => `${k}=${v}`).join(" ")}\n`);

type Condition = { name: string; intentWeight: number; intents: TaskIntent[] };
const shuffled = queryIntents.map((_, i) => queryIntents[(i + 1) % queryIntents.length]!);
const conditions: Condition[] = [
  { name: "baseline (intent=0)  ", intentWeight: 0, intents: queryIntents },
  { name: `intent-on (w=${WEIGHT}) `, intentWeight: WEIGHT, intents: queryIntents },
  { name: `shuffled (w=${WEIGHT})`, intentWeight: WEIGHT, intents: shuffled },
];

const perCondition = new Map<string, CondMetrics>();
const hitsPerCondition = new Map<string, boolean[]>();

for (const cond of conditions) {
  const metrics: CondMetrics = { hit: { 3: [], 5: [], 10: [] }, mrr: [] };
  const hit5: boolean[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const evidence = byRelated.get(entry.instance_id)!;
    const retrieved: SearchResult[] = await store.searchByEmbedding(entry.embedding, 10, {
      queryText: entry.problem_statement,
      rerank: true,
      rerankMode: "keyword",
      temporalHops: 1,
      projectName: SWE_CONTEXT_PROJECT_NAME,
      taskIntent: cond.intents[i],
      featureWeights: { intent: cond.intentWeight },
    });
    const labels = retrieved.map(r => r.node.label).filter((l): l is string => Boolean(l));
    for (const k of KS) {
      metrics.hit[k]!.push(labels.slice(0, k).some(l => evidence.includes(l)) ? 1 : 0);
    }
    const firstHit = labels.findIndex(l => evidence.includes(l));
    metrics.mrr.push(firstHit >= 0 ? 1 / (firstHit + 1) : 0);
    hit5.push(labels.slice(0, 5).some(l => evidence.includes(l)));
  }
  perCondition.set(cond.name, metrics);
  hitsPerCondition.set(cond.name, hit5);
  console.log(`  done: ${cond.name.trim()}`);
}
console.log();

const header = `${"Condition".padEnd(22)} | Hit@3  | Hit@5  | Hit@10 | MRR`;
console.log(header);
console.log("-".repeat(header.length));
for (const cond of conditions) {
  const m = perCondition.get(cond.name)!;
  console.log(
    `${cond.name.padEnd(22)} | ${pct(mean(m.hit[3]!)).padStart(5)}% | ${pct(mean(m.hit[5]!)).padStart(5)}% | ${pct(mean(m.hit[10]!)).padStart(5)}% | ${pct(mean(m.mrr)).padStart(5)}%`,
  );
}

// Flip analysis: intent-on vs baseline at @5.
const base = hitsPerCondition.get(conditions[0]!.name)!;
const on = hitsPerCondition.get(conditions[1]!.name)!;
const fixed: string[] = [];
const broken: string[] = [];
for (let i = 0; i < entries.length; i++) {
  if (!base[i] && on[i]) fixed.push(entries[i]!.instance_id);
  if (base[i] && !on[i]) broken.push(entries[i]!.instance_id);
}
console.log(`\nintent-on vs baseline @5: ${fixed.length} fixed, ${broken.length} broken (${entries.length} queries)`);
if (fixed.length > 0) console.log(`  fixed   : ${fixed.slice(0, 5).join(", ")}`);
if (broken.length > 0) console.log(`  broken  : ${broken.slice(0, 5).join(", ")}`);

await store.close();
fs.rmSync(dbDir, { recursive: true, force: true });
