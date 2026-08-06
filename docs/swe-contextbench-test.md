# SWE-ContextBench Retrieval Test

How the real coding-agent memory evaluation works: `src/storage/search.swecontext.test.ts` measures whether the plugin's hybrid retrieval can find a *past experience* (a full Claude Code debugging session on a GitHub issue) when queried with a *related issue* from the same repository.

It replaces the dialogue-only LoCoMo test as the primary retrieval-quality signal: instead of "can we find a chat about X?", it answers "can the memory store recall the most similar past bug-fixing session for this new bug report?" — the retrieval problem a coding agent actually faces.

## Dataset: SWE-ContextBench Lite

From [jiayuanz3/SWEContextBench](https://github.com/jiayuanz3/SWEContextBench) (MIT):

| Piece | Count | Contents |
|---|---|---|
| **Experience trajectories** | 300 | Real Claude Code JSONL sessions that fixed a SWE-bench issue: user message with `problem_statement`, assistant `thinking` blocks, `tool_use` calls (Read/Bash/Edit…), `file-history-snapshot` records. |
| **Related tasks** | 99 | SWE-bench-format JSON issues (`problem_statement`, `patch`, `FAIL_TO_PASS`, `base_commit`) from the same 12 repos (django, scikit-learn, sympy, matplotlib, flask, requests, astropy, xarray, sphinx, seaborn, pylint, pytest). |
| **Ground truth** | 118 links | `SWEContextBench_Relationship.parquet` maps `related_instance_id → experience_instance_id` — i.e. "this new issue is related to that past session". 99 of the links match Lite related tasks; they span 72 distinct experience sessions. |

The core evaluation assumption: if the plugin retrieves the experience node whose `instance_id` appears in the relationship ground truth for a related task's query, that is a **hit** — the memory system surfaced the right past session.

## Pipeline

```
scripts/benchmark/fetch-swe-context.ts     (one-time; needs network)
  └─ downloads raw JSONLs + parquet → extracts compact dataset
  └─ writes committed dataset → tests/dbs/swe-contextbench/{experience,related,relationship}.json

scripts/benchmark/seed-swe-context.ts      (called by the test's beforeAll)
  └─ loads compact dataset → embeds content (ONNX) → bulk-inserts nodes
  └─ BM25 backfill → HNSW rebuild → writes related-embeddings.json

src/storage/search.swecontext.test.ts      (bun test)
  └─ seeds a fresh temp DB → runs 99 queries → prints per-repo table → asserts
```

### 1. Fetch (one-time, network required)

`bun run scripts/benchmark/fetch-swe-context.ts`

- Lists the GitHub `cases/SWEContextBench Lite Past Experience/` and `cases/SWEContextBench Lite/` directories via the contents API.
- Downloads 300 trajectory JSONLs and 99 related-task JSONs from `raw.githubusercontent.com`, plus the relationship parquet from Hugging Face.
- Decodes the parquet with **hyparquet** (`parquetReadObjects`, zero-dependency, `bunx`-able).
- Extracts from each trajectory:
  - `summary` (from the summary block, searching all lines — some sessions put it after line 0)
  - `problem_statement` + `instance_id` (from the user message containing `instance_id:`)
  - `touched_files` (file paths from `tool_use.input.file_path` + `trackedFileBackups`)
  - `reasoning` — concatenated assistant `thinking` blocks, capped at 2500 chars
  - `tool_sequence` — up to 12 tool calls as `{name, target}` where target is the file path or command head
- Raw downloads land in `scripts/benchmark/data/swe-context/raw` (**gitignored**); the compact JSONs are written to **`tests/dbs/swe-contextbench/` and committed** so the test runs fully offline.

### 2. Seed (offline, ~2s using cached embeddings)

`seedSweContextDatabase(outDir, { regenerateEmbeddings? })` — `scripts/benchmark/seed-swe-context.ts`

For each of the 300 experiences it inserts a **project-scope** node into a fresh temp SQLite DB:

- **label** `swe:{instance_id}` — this is the retrieval target / evidence label
- **content** (reasoning first so it lands inside the embedder's 256-token window):

  ```
  Reasoning: <thinking blocks>
  Summary: <session summary>
  Issue: <problem_statement>
  Trajectory: Read(foo.py) -> Bash(grep ...) -> Edit(foo.py) -> ...
  Files touched: foo.py, tests/test_foo.py
  ```
- **tags** `[repo, "swe:experience"]`, type `note`, category `episodic`, `source: tool_result`, `project_name: swe-contextbench`
- Plus up to 8 per-file nodes (`swe:{id}:file:{path}`, tags `[repo, "swe:file"]`, **no embedding** — BM25-only) connected to the experience node with a `DURING_SESSION` temporal edge.

Then: `backfillBinaryEmbeddingsAndBM25("project")` and `rebuildHNSWIndex("project")`.

**Embedding caches** make the test fast and deterministic:
- `experience-embeddings.bin` — 300×384-dim Float32 (460 KB), regenerated only when content changes (`regenerateEmbeddings: true`, ~34 s ONNX)
- `related-embeddings.json` — 99 query embeddings, written next to the seeded DB

One-time regeneration: `bun run` a script calling `seedSweContextDatabase(dir, { regenerateEmbeddings: true })`.

### 3. Test (offline, ~40 s)

`src/storage/search.swecontext.test.ts` — `bun test src/storage/search.swecontext.test.ts`

- `beforeAll`: seeds a fresh temp DB, opens a `MemoryStore` on it, loads `related-embeddings.json` (the 99 query entries) and the relationship ground truth (as `Set` of evidence labels per related task).
- **Query**: for each of the 99 related tasks, call the exact retrieval path a real agent's `memory_search` would use:

  ```ts
  store.searchByEmbedding(entry.embedding, 10, {
    queryText: entry.problem_statement,
    rerank: true,
    temporalHops: 1,
    projectName: SWE_CONTEXT_PROJECT_NAME,
  })
  ```

  This exercises the full hybrid pipeline in `src/storage/search.ts`: HNSW vector candidates → BM25 across all scope nodes → RRF fusion (`computeRRFScores`) → keyword rerank (`rerankResults`) → 1-hop temporal expansion along `DURING_SESSION` edges to the file nodes.

  The test A/Bs two rerank modes against each other (same query set, same store):
  - `rerankMode: "keyword"` — the historical `rerankResults` keyword/position heuristic
  - `rerankMode: "cross-encoder"` — local ONNX cross-encoder (`ms-marco-MiniLM-L-6-v2` via `scorePairs`, no Ollama/network). Reranks a wider candidate pool (≥20) than the keyword path.

- **Metrics** per query at K ∈ {3, 5, 10} (`computeMetrics`):
  - `hitRate` — 1 if any of the top-K labels is an evidence label
  - `precision` — evidence hits / K
  - `recall` — evidence hits / total evidence labels for that query
  - `mrr` — 1/(rank of first evidence hit)
- Aggregated per repo (weighted) and printed as a table; the headline **Overall HitRate@5** is the query-weighted average.
- **Assertions**: ≥ 4 repos, ≥ 50 queries, keyword HitRate@5 > 0, and **cross-encoder HitRate@5 > keyword HitRate@5**.

## Results

| Metric | Value |
|---|---|
| Overall HitRate@5 (keyword rerank) | **27.3%** (27/99 queries) |
| Overall HitRate@10 (keyword rerank) | 44.4% (44/99) |
| **Overall HitRate@5 (cross-encoder)** | **51.5%** (51/99) |
| **Overall HitRate@10 (cross-encoder)** | 58.6% (58/99) |
| Best repo | flask 100%@5 (1/1), astropy/xarray reach 100%@10 |
| Strongest | django 10/36@5 → 16/36@10, sympy 10/26@10 |
| Weakest | seaborn, pylint, sphinx, flask @5 ≈ 0% |

Adding trajectory reasoning + tool-call traces to node content (vs summary+issue only): **HitRate@5 unchanged (27/99), HitRate@10 improved 41→44/99** — a wash at K=5, mild win at K=10, with per-repo redistribution (django 8→10@5, astropy/xarray/pytest 0→1; flask 1→0, sklearn 6→4). The K=10 jumps (astropy, xarray 0→100) mark reranking opportunities.

**Cross-encoder rerank is the big win**: swapping the keyword heuristic for the local ONNX cross-encoder (`rerankMode: "cross-encoder"`) nearly doubles HitRate@5 (27.3% → **51.5%**) and lifts HitRate@10 (44.4% → **58.6%**). Deterministic (CPU ONNX), no Ollama/network, ~4 min for the 99-query A/B. The candidate pool is widened to ≥20 before scoring since the cross-encoder is cheap enough. A standalone harness (`scripts/benchmark/eval-ollama-rerank.ts`) reports the same ranking over a fixed 20-candidate pool (pool 36.4% → cross-encoder 55.6% @5).

**Config**: `ollama.strategy: "cross-encoder"` in `opencode-mem.json` sets the memory search tool's default `rerank_mode` (per-call `rerank_mode` on the memory tool always overrides). `"llm"` maps to the keyword rerank.

## Gotchas

- **The seed and the test must share a process.** `searchByEmbedding` uses an in-memory HNSW singleton (`getHNSWIndex`). If a store is opened without seeding/rebuilding in the same process, the singleton is empty and search silently falls back to a raw-SQL path (search.ts:213) that skips vector retrieval — producing inflated, meaningless numbers. The test is correct because `beforeAll` seeds in-process; ad-hoc verification scripts must call `store.rebuildHNSWIndex("project")` first.
- **The embedder truncates at ~256 tokens**, so content order matters — reasoning is placed first deliberately.
- **The cross-encoder model outputs `[N, 1]` logits (single class per pair)** — `scorePairs` must read `data[b]` per batch row, not a 2-class head (`data[b*2]`/`data[b*2+1]`). Batched inference pads to the batch max length; scores match per-pair inference within ~2e-5.
- 30/300 trajectories have no thinking blocks (reasoning empty); all 300 have tool sequences.
- `scikit-learn__scikit-learn-26323` is genuinely absent from the Lite trajectory folder; its related task still links to another experience, so no query is unanswerable.
- After any change that alters node content, regenerate embedding caches (`regenerateEmbeddings: true`) before trusting results.

## Run

```bash
bun run scripts/benchmark/fetch-swe-context.ts   # only if dataset missing/stale (network)
bun test src/storage/search.swecontext.test.ts   # offline, seeds in ~2 s; A/B runs ~4.5 min (cross-encoder inference dominates)
bun run scripts/benchmark/eval-ollama-rerank.ts 99 cross-encoder   # standalone pool@20 harness (~4 min)
bun run lint && bun run typecheck                # before committing
```

Full suite: `bun test` (36 files; this test self-seeds in ~2 s; the keyword-only portion runs ~40 s, the cross-encoder A/B adds ~4 min).
