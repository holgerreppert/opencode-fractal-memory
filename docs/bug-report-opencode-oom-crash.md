# Bug Report: OpenCode OOM Crash During Compaction

**Date:** 2026-08-13
**Plugin:** `opencode-fractal-memory` (v0.7.17)
**Project:** `bewerberapp`
**Severity:** Critical — opencode crashed 3× while compacting with native opencode compaction; plugin had to be disabled.

## Summary

The plugin runs **in-process inside opencode**, so its memory footprint is opencode's
memory footprint. During native opencode compaction, the plugin stacked multiple heavy,
in-memory operations on a memory-starved machine (15GB RAM, ~2.1GB free, ~5.2GB of 8GB
swap already in use). The kernel OOM-killer took down the entire opencode process three
times, forcing the plugin to be disabled.

## Symptoms

- opencode crashed 3× while compacting using opencode's built-in compaction option.
- Plugin log repeatedly records the failure, always a caught `RangeError: Out of memory`:

```
[error] [compaction] Failed to capture middle-term context
        {"sessionId":"ses_170c...","error":"RangeError: Out of memory"}
```

- RSS spikes observed while the plugin was active:
  - `rssMB: 4144` during a background graph build (11:55:57)
  - `rssMB: 1738` at plugin startup
  - `rssMB: 1966` right after the background embedding task
- The `compaction` handler error is **caught** (so it logs and returns `out.context = []`),
  but the same allocation pressure kills the whole process before/around that point.

## Root Cause

Two independent root causes, both tied to the plugin running **synchronously in-process**
inside opencode:

### 1. Code graph build — WASM heap accumulation bug in `@kreuzberg/tree-sitter-language-pack-wasm@1.10.9`

Investigation (2026-08-13) isolated this as a **module-level memory bug**, not a usage error:

- `session.idle` triggers `ensureBackgroundGraph(root, maxFiles)` which calls
  `buildGraph()` — a fully **synchronous, in-process** loop that reads every file and
  parses it with tree-sitter WASM (`src/application/graph/build.ts:36-89`).
- Graph rebuilds also fire on edit/write via `graph-edit-check.ts` and `graph-refresh.ts`.
- User config sets `graph.maxFiles: 10000`. The `bewerberapp` project has **3263 files**.
  The log shows `fileNodes: 3055, symbolNodes: 390` and RSS reaching **4144MB**.
- The built graph is **retained in memory** (module-level `backgroundGraph`/`activeGraph`
  globals in `src/application/graph/build.ts`).

**The WASM bug — controlled experiments:**

| Test | Result |
|---|---|
| Same `.ts` file parsed 250× in a fresh process | **0 failures** |
| 279 distinct `.ts` files, module `process()` | fails at file **#160-162**, then *every* file fails |
| 279 distinct `.ts` files, fresh `getParser()`+`parse()` per file | **145 failures** |
| 279 distinct `.ts` files, single parser + `reset()` per file | **272 failures** |
| Fresh `WasmLanguageRegistry.new()` | `Not implemented: process` (stub) |
| All 23 WASM languages, trivial snippet | **0 failures** |
| `.py` sample (imports/function/class) | 4 symbols extracted correctly |

- Failure point is **nondeterministic across runs** (file #6, #160, #162, 272) — the
  signature of WASM **memory corruption / use-after-free**, not a syntax construct.
- The npm docs state parsers are "cached once, then reused by every call in the process."
  Module-level `process()` reuses a **shared global parser**; tree-sitter's **incremental
  parsing** across *different* contents accumulates/corrupts WASM linear memory until an
  `Out of bounds memory access` / `Unreachable code should not be executed` trap.
- This matches known upstream issues: tree-sitter#5547 (global `scratch_query_cursor`
  grows unboundedly, never shrinks → OOM), continue#1672 (600-file TS repo →
  `table index is out of bounds`, fixed only by caching Language objects),
  tree-sitter#1444 (incremental parse corrupts the tree across edits).
- `@kreuzberg/tree-sitter-language-pack-wasm@1.10.9` is the latest published npm version;
  the docs describe v1.14.3 (unpublished) — no fix available by upgrading.
- **Python is fully supported** (verified end-to-end). `bewerberapp` was never the parse
  problem — it just had enough files (3263) to trip the accumulation bug.

**Consequence:** the graph build both (a) burns ~4GB RSS in opencode's process and
(b) crashes mid-way once WASM memory is exhausted. The memory is spent on work that
partially fails anyway.

### Library comparison (2026-08-13) — stay on kreuzberg + isolate

| Option | Verdict |
|---|---|
| `@kreuzberg/tree-sitter-language-pack-wasm@1.10.9` (current) | Single bundled WASM, 30 curated languages, one `process()` call, actively maintained (docs describe v1.14.3, unpublished). The accumulation bug is real but **fully containable** via per-batch isolation. |
| `web-tree-sitter@0.26.12` (official) | Canonical, TS-rewritten, proper `FinalizationRegistry` cleanup. **But**: grammars are per-language `.wasm` files you must source. Official grammar npm packages mostly DON'T ship `.wasm` (only typescript, python, elixir, svelte, dart, scala, haskell, css of our 30 do). Also has its own global `scratch_query_cursor` leak (#5547). Large migration for worse language coverage. |
| `tree-sitter-wasms@0.1.13` (Gregoor) | Bundles ~100 prebuilt grammars, **but frozen on tree-sitter-cli 0.20.x ABI** — incompatible with `web-tree-sitter@0.26.x` (`dylink.0` mismatch, issue #5171). Dead end. |

**Controlled experiment (fresh-instance reset):** re-requiring the module (cleared
require cache → fresh WASM heap) every N files: chunk=50 → 274/278 succeed (vs 7/279
shared-instance); chunk=30 → 266/278. **But failures are nondeterministic across runs**
(a file that parses standalone fails after prior re-requires) — the in-process
re-require trick is NOT safe. The deterministic solution is fresh OS processes
(subprocess isolation, fix #4 below), where nothing is shared and the heap is fresh
per batch.

### 2. Compaction hook fetches full session + embeds in-process

On opencode's native compaction (`src/plugin/hooks/compaction.ts`):

- `client.session.messages({ path: { id: sessionId }, query: { limit: 50 } })`
  pulls up to **50 full messages** (line 144). Text parts are concatenated **uncapped**
  (lines 196-197); tool results each contribute up to 500 chars (line 203).
- Then `generateEmbeddingWithSegments` runs the **gte-small ONNX model in-process**
  (`src/infrastructure/llm/embeddings.ts`) — on top of the **cross-encoder model**
  (loaded at search because config uses `ollama.strategy: "cross-encoder"`) and the
  gte-small tokenizer, which are already resident.

### 3. Resident ONNX models + HNSW index

- Three ONNX models live in-process:
  - `gte-small` (~33MB quantized, embeddings) — `src/infrastructure/llm/embeddings.ts`
  - `ms-marco-MiniLM-L-6-v2` (~23MB quantized, cross-encoder rerank) — `src/infrastructure/llm/cross-encoder.ts`
  - `all-MiniLM-L6-v2` (~22MB quantized) — optional MiniLM path
- HNSW index (~30MB JSON) restored at startup.

There is **no memory guard anywhere**: compaction + graph + 3 ONNX models + HNSW +
opencode's own compaction all share one 15GB process.

## Log Evidence

Relevant code locations:

| Path | Line(s) | Role |
|---|---|---|
| `src/application/graph/build.ts` | 36-89 | Synchronous in-process graph build (reads + parses all files) |
| `src/application/graph/build.ts` | 193-216 | `ensureBackgroundGraph` — retains graph in memory, fires on idle |
| `src/plugin/hooks/events.ts` | 69-74 | `session.idle` triggers `ensureBackgroundGraph` |
| `src/plugin/hooks/compaction.ts` | 144 | Fetches up to 50 session messages |
| `src/plugin/hooks/compaction.ts` | 196-197, 203 | Uncapped text concat / 500-char tool results |
| `src/plugin/hooks/compaction.ts` | 244 | In-process embedding of the archived conversation |
| `src/plugin/hooks/compaction.ts` | 274-277 | Caught `RangeError: Out of memory` logged here |
| `src/infrastructure/llm/embeddings.ts` | 37-43 | Lazy-loads gte-small session in-process |
| `src/infrastructure/llm/cross-encoder.ts` | 25-27 | Lazy-loads cross-encoder in-process |

Observed log lines (from `~/.config/opencode/logs/memory-plugin.log`):

```
[graph] ensureBackgroundGraph start {"hasGraph":true,"rssMB":4144}
[graph] Build diagnostics {"totalFound":321,... "fileNodes":389,"symbolNodes":205,"rssMB":1519}
[compaction] Failed to capture middle-term context {"error":"RangeError: Out of memory"}
[init] Restoring HNSW index {"rssMB":479}
[hnsw] HNSW index loaded from disk {"globalNodes":119,"projectNodes":952,"bytes":30642238,"rssMB":706}
[embeddings] Background embedding task started {"totalNodes":100,"rssMB":1966}
```

## System Context

```
Mem:  15Gi total   10Gi used   2.1Gi free   902Mi shared   4.3Gi buff/cache   5.2Gi available
Swap: 8.0Gi total   5.2Gi used   2.8Gi free
CPU:  4 cores
```

## Fix Decisions (2026-08-13 review)

The following supersede the earlier "quick fix" list:

### 1. RSS / free-memory gate — REJECTED
We don't know the true memory budget, so a threshold is guesswork and a band-aid over the
real issue (in-process execution of heavy work). Not pursued.

### 2. Scale `maxFiles` by free memory — REJECTED
Same guessing problem as #1. The real fix is isolation (below), not capping.

### 3. Compaction storage — REDESIGN UNDER DISCUSSION
Open question: **what should we actually store from compacted sessions?** The current
handler grabs up to 50 full messages and embeds the dump — the memory-heavy part. Options:

- **A. Minimal**: decision / tool / file-change summary only (the extractors
  `extractKeyErrors`, `extractFilePaths`, `extractToolUse` already compute these) — small,
  cheap, no raw message dump.
- **B. Structured archive**: YAML frontmatter summary + tool-call trace only, truncating
  text parts per-message (not just a total accumulator); drop the embedding step.
- **C. Current**: raw-ish conversation dump + in-process embedding — the crashing path.

Pending user decision (A/B/C) before implementing. Note: the `RangeError: Out of memory`
logged by this handler is *caught*; the crashes came from the graph build (root cause #1).

### 4. Graph build in a subprocess — ACCEPTED (primary fix)
`buildGraph` is fully synchronous and CPU/parse-heavy. Running it inside the already-spawned
management-server bun subprocess gives real process isolation. **This is the primary fix**:
it removes both the memory and the parse-crash risk from opencode's process.

**Design refinement from the WASM investigation + library comparison:** the WASM accumulation
bug crashes even a *single* long build (~160-300 files in-process), so a single subprocess
build of a 3263-file project would still die mid-way. The robust design is **batched
extraction**: parse files in small batches (e.g. 100/batch), each batch in a **fresh
subprocess** (fresh WASM heap → leak bounded per batch), then merge results into the graph
in the parent. This also bounds per-subprocess memory regardless of `maxFiles`. Keep
`@kreuzberg/tree-sitter-language-pack-wasm` (see library comparison) — switching libs gives
worse coverage and its own leaks.

## Status

- **Investigation:** complete. Root cause: WASM heap accumulation in
  `@kreuzberg/tree-sitter-language-pack-wasm@1.10.9` under many-file parses, executed
  in-process inside opencode.
- **Fixes:** not yet implemented (fix #4 in progress; fix #3 awaiting storage-design decision).
- **Workaround:** disable the plugin (as done) or reduce `graph.maxFiles` in
  `~/.config/opencode/opencode-mem.json` (only postpones the WASM crash).
