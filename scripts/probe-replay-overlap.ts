/**
 * Read-only diagnostic: why does Dream-RSI replay score overlap = 0 even for
 * injection_metrics rows that HAVE post_rerank_ids?
 *
 * Reproduces replaySessionQueries' re-retrieval (searchNodes, limit 10, each
 * DEFAULT_STRATEGIES variant) for the 3 real post-rerank rows and reports the
 * actual rank of each originally-injected node id at k=10 and k=50.
 *
 * Run: bun run scripts/probe-replay-overlap.ts
 */
import * as path from "node:path";
import * as os from "node:os";
import { createSqliteMemoryStore } from "../src/storage/sqlite";
import { searchNodes } from "../src/application/search";
import { generateEmbedding } from "../src/infrastructure/llm/embeddings";

const PROJECT_DIR = path.join(os.homedir(), "Documents", "projects", "opencode-agent-memory-main");
const store = createSqliteMemoryStore(PROJECT_DIR);
const embed = async (text: string): Promise<number[]> => generateEmbedding(text);

interface ProbeRow {
  session: string;
  ts: string;
  query: string;
  postIds: string[];
}

async function loadRows(): Promise<ProbeRow[]> {
  const metrics = await store.getInjectionMetrics(200);
  return metrics
    .filter(m => m.postRerankIds && m.postRerankIds.length > 0 && m.queryText && m.queryText.length > 2)
    .map(m => ({
      session: m.sessionId.slice(0, 18),
      ts: new Date(m.timestamp).toISOString().slice(11, 19),
      query: m.queryText!,
      postIds: m.postRerankIds!,
    }));
}

const STRATEGIES: Array<{ id: string; rerankMode?: "keyword" | "cross-encoder"; intent?: "read" | "edit" | "debug" | "discovery" }> = [
  { id: "keyword", rerankMode: "keyword" },
  { id: "cross-encoder", rerankMode: "cross-encoder" },
  { id: "cross-encoder+debug", rerankMode: "cross-encoder", intent: "debug" },
  { id: "cross-encoder+read", rerankMode: "cross-encoder", intent: "read" },
  { id: "cross-encoder+edit", rerankMode: "cross-encoder", intent: "edit" },
];

function labelOf(results: Array<{ node: { id: string } }>, id: string): number {
  const idx = results.findIndex(r => r.node.id === id);
  return idx === -1 ? -1 : idx + 1;
}

async function main() {
  const rows = await loadRows();
  console.log(`probe rows with postRerankIds: ${rows.length}\n`);

  for (const row of rows) {
    const targetIds = [...new Set(row.postIds)];
    const targetLabels = await Promise.all(
      targetIds.map(async id => {
        try {
          const n = await store.getNode(id);
          return `${id.slice(0, 8)}=${n.label ?? "?"}`;
        } catch {
          return `${id.slice(0, 8)}=?`;
        }
      }),
    );
    console.log("=" .repeat(100));
    console.log(`session=${row.session} ts=${row.ts} targets: ${targetLabels.join(", ")}`);
    console.log(`query: ${JSON.stringify(row.query.slice(0, 160))}${row.query.length > 160 ? ` …(${row.query.length} chars)` : ""}`);

    // labels of all targets first so rows are readable

    // 1) drilldown baseline — the pipeline messages-transform injections used
    {
      const t0 = Date.now();
      const drill = await store.drilldownQuery(row.query, 5, store.projectName);
      const ranks = targetIds.map(id => labelOf(drill, id));
      const hit = ranks.map(r => (r > 0 ? `#${r}` : "MISS"));
      const overlap = ranks.filter(r => r > 0).length;
      console.log(
        `  k= 5 drilldown(baseline) ${hit.join(" ").padEnd(20)} ${String(Date.now() - t0).padStart(5)}ms  overlap=${overlap}/${targetIds.length}`,
      );
    }

    for (const k of [10, 50]) {
      for (const strat of STRATEGIES) {
        const opts = {
          limit: k,
          rerank: true,
          projectName: store.projectName,
          ...(strat.rerankMode ? { rerankMode: strat.rerankMode } : {}),
          ...(strat.intent ? { intent: strat.intent } : {}),
        };
        const t0 = Date.now();
        const results = await searchNodes(store, embed, row.query, opts);
        const ranks = targetIds.map(id => labelOf(results, id));
        const hit = ranks.map(r => (r > 0 && r <= k ? `#${r}` : r > 0 ? `#${r} (>${k})` : "MISS"));
        const top = results.slice(0, 3).map(r => (r.node.label ?? r.node.id.slice(0, 8)).slice(0, 42));
        console.log(
          `  k=${String(k).padStart(2)} ${strat.id.padEnd(19)} ${hit.join(" ").padEnd(20)} ${String(Date.now() - t0).padStart(5)}ms  top3: ${top.join(" | ")}`,
        );
      }
    }

    // raw pool (no rerank) at k=10 — isolates rerank from candidate generation
    const raw = await searchNodes(store, embed, row.query, { limit: 10, rerank: false, projectName: store.projectName });
    const rawRanks = targetIds.map(id => labelOf(raw, id));
    console.log(`  k=10 no-rerank          ${rawRanks.map(r => (r > 0 ? `#${r}` : "MISS")).join(" ").padEnd(20)}`);
    console.log();
  }
}

await main();
