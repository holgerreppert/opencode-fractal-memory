import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSqliteMemoryStore } from "../../src/storage/sqlite";
import { loadRelationshipLinks, labelForExperience } from "./datasets/swe-context";
import { seedSweContextDatabase, SWE_CONTEXT_PROJECT_NAME } from "./seed-swe-context";
import { rerankDocuments } from "../../src/infrastructure/llm/ollama";

const BASE_URL = "http://localhost:11434";
const MODEL = "Qwen2.5-Coder:latest";
const STRATEGY = (process.argv[3] ?? "llm") as "llm" | "cross-encoder";
const POOL = 20;
const TOPK = 10;

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "swe-ollama-"));
const result = await seedSweContextDatabase(dbDir);
const store = createSqliteMemoryStore(dbDir, result.dbPath);

const rel = loadRelationshipLinks();
const byRelated = new Map(rel.map(l => [l.related_instance_id, l.experience_instance_ids.map(labelForExperience)]));
const withEmb = JSON.parse(fs.readFileSync(path.join(dbDir, "related-embeddings-gte-small.json"), "utf-8")) as Array<{
  instance_id: string; repo: string; problem_statement: string; embedding: number[];
}>;

const MAX = Number(process.argv[2] ?? "10");
const CONC = 3;
const entries = withEmb.filter(e => { const ev = byRelated.get(e.instance_id) ?? []; return ev.length > 0; }).slice(0, MAX);

const stats = { poolHit5: 0, ollamaHit5: 0, poolHit10: 0, ollamaHit10: 0, total: 0, failures: 0 };
let done = 0;

async function evaluate(entry: (typeof withEmb)[number]) {
  const evidence = byRelated.get(entry.instance_id) ?? [];
  const pool = await store.searchByEmbedding(entry.embedding, POOL, {
    queryText: entry.problem_statement, rerank: false, temporalHops: 1, projectName: SWE_CONTEXT_PROJECT_NAME,
  });
  const hit = (nodes: Array<{ label?: string | null }>, k: number) =>
    nodes.slice(0, k).some(n => n.label && evidence.includes(n.label));
  let ollamaOrder = pool;
  try {
    const out = await rerankDocuments(entry.problem_statement, pool.map(n => ({ id: n.id, label: n.label ?? "", content: n.content })), {
      baseUrl: BASE_URL, model: MODEL, strategy: STRATEGY, topK: TOPK,
    });
    const byId = new Map(out.allScores.map(r => [r.id, r.score]));
    ollamaOrder = [...pool].sort((a, b) => (byId.get(b.id) ?? 0) - (byId.get(a.id) ?? 0));
  } catch { stats.failures++; }
  return { entry, pool, ollamaOrder, evidence };
}

let index = 0;
while (index < entries.length) {
  const batch = entries.slice(index, index + CONC);
  const results = await Promise.all(batch.map(evaluate));
  for (const { entry, pool, ollamaOrder, evidence } of results) {
    const hit = (nodes: Array<{ label?: string | null }>, k: number) =>
      nodes.slice(0, k).some(n => n.label && evidence.includes(n.label));
    const poolHit5 = hit(pool, 5);
    stats.poolHit5 += poolHit5 ? 1 : 0;
    stats.poolHit10 += hit(pool, 10) ? 1 : 0;
    stats.ollamaHit5 += hit(ollamaOrder, 5) ? 1 : 0;
    stats.ollamaHit10 += hit(ollamaOrder, 10) ? 1 : 0;
    stats.total++;
    done++;
    if (done <= 3 || poolHit5 !== hit(ollamaOrder, 5)) {
      console.log(`\n[${done}] ${entry.instance_id}`);
      console.log(`  evidence: ${evidence.join(", ")}`);
      console.log(`  pool    : ${pool.slice(0, 8).map(n => n.label).join(" | ")}`);
      console.log(`  ollama  : ${ollamaOrder.slice(0, 8).map(n => n.label).join(" | ")}`);
    }
  }
  console.log(`  ...${done}/${entries.length} done, failures=${stats.failures}`);
  index += CONC;
}

const pct = (n: number) => (100 * n / stats.total).toFixed(1);
console.log(`\n=== ${stats.total} queries ===`);
console.log(`pool  HitRate@5: ${pct(stats.poolHit5)}%  HitRate@10: ${pct(stats.poolHit10)}%`);
console.log(`ollama HitRate@5: ${pct(stats.ollamaHit5)}%  HitRate@10: ${pct(stats.ollamaHit10)}%`);
console.log(`ollama failures: ${stats.failures}`);

await store.close();
fs.rmSync(dbDir, { recursive: true, force: true });
