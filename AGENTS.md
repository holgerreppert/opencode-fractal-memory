# opencode-fractal-memory

Plugin providing infinite context memory for OpenCode via SQLite, embeddings, and BM25 hybrid search.

## Architecture

- **Layers**: domain ports (`src/domain/ports/` — interfaces only) ← infrastructure (`src/storage/`, `src/infrastructure/`) ← application logic (`src/application/`) ← plugin adapters (`src/plugin/hooks/`). Composition root at `src/infrastructure/composition-root.ts` wires everything.
- **Storage**: SQLite (`~/.config/opencode/memory.db`), sqlite-vec brute-force `vec_distance_cosine` on `memory_nodes.embedding_blob` (cosine sim, `src/infrastructure/vector/sqlite-vec-adapter.ts`, `v0.1.9`; `hnsw-index.ts` kept as fallback), FTS5 (BM25)
- **Hooks** (`tool.execute.before`/`after`, `experimental.chat.system.transform`, `experimental.chat.messages.transform`, `chat.message`, `event`): ~20 extracted handlers in `src/plugin/hooks/`, orchestrated by `src/plugin/hooks.ts`
- **Management app**: served on `http://localhost:8787`, spawned as subprocess. API at `src/management/routes.ts`, UI at `management/public/`
- **Config**: `~/.config/opencode/opencode-mem.json`, Zod schema at `src/infrastructure/config/config.ts`
- **Logging**: per-feature logs at `~/.config/opencode/logs/` — `memory-plugin.log`, `compress.log`, `sessionlog.log`, `graph-usage.log` (`src/logging.ts`)

## Features

- **Command Output Compression** (`tool.execute.after` for `bash`): content-type router (`output-types/` coverage-log/compiler-diagnostics/test-output) before tiered pipeline (verbatim pass-through below thresholds, net-win gate, benign/error-aware), per-tool budgets (`perTool` via longest-prefix: test→2500 error-first, ls→800 names, grep→1200, git diff→2000), error-first for any failing bash (before signal gate), Squeez task-conditioned verbatim extraction (`squeez.ts` KRLabsOrg/squeez-2b 0.86 recall vs BM25 0.22, POST /extract → relevant_lines[], fails-open, empty→[squeez-negative], `deferToIdle`). Payload-preserving strategies (grep/ls/git-status/table), structural shape detection, fuzzy dedup, delta compression, output offloading. Always reversible — original stashed with `[Original stashed — cat <path>]` marker. Impl: `src/application/command-compression/pipeline.ts` (orchestration), `strategy.ts` (registry), `squeez.ts`, `config.ts` (`perTool`/`squeezExtraction`), `src/infrastructure/config/config.ts` (schema+deep-merge), `src/plugin/hooks/compression.ts`; `strategies/`, `output-types/`.
- **Output Token Control** (`experimental.chat.system.transform`): injects concise-output rule based on context pressure. Modes: adaptive/always-on/off; strategies: concise/sentence_limit/char_limit/bullet_only/custom. Impl at `src/application/output-token-control.ts`.
- **Re-Read Elimination** (`tool.execute.after` for `read`): serves cached file content when mtime unchanged — output delivery MUST live in `tool.after` (writable `{output}`); `tool.before` only exposes `{args}` and silently drops `output.output` writes. Impl at `src/application/re-read-elimination.ts`.
- **Auto Graph Hints** (`tool.execute.after` for `grep`/`glob`/`search`): appends up to 3 symbol suggestions as a `[code-graph-search-hint]` block. Impl at `src/plugin/hooks/graph-search-hint.ts`.
- **Auto-Skeletonize on Large Reads** (`tool.execute.after` for `read`): generates skeleton via `extractSkeleton` for files ≥ `autoSkeletonizeMinLines` (default 300). Impl at `src/plugin/hooks/graph-context.ts`.
- **Auto-Retrieve** (`experimental.chat.messages.transform`): reranking pipeline (LLM judge via `client.session.prompt({noReply:true})`, Ollama fallback, ONNX cross-encoder). Pressure-aware injection: aggressive phase filters importance ≥ 0.6, critical ≥ 0.8. Impl at `src/application/auto-retrieve/`.
- **Injection Visibility**: every injection surface emits `[memory-plugin:<feature>]` inline markers + a per-turn digest summary message, and persists to `injection_metrics` (so previously-silent injections — re-read, compression, graph-context — appear in the management live feed). Config: `injectionVisibility {enabled, markers, digest}` (all default true). Impl: `src/application/injection-visibility.ts`, `src/plugin/hooks/injection-digest.ts`.
- **Memory Categorization**: nodes have `type` → `category` (episodic/semantic) + `supertype` (declarative/procedural/experiential/meta). `searchByEmbedding` accepts `intent` (read/edit/debug/discovery) with temporal stratification, entity boosting, and purpose-type boosting (`debug`→`lesson`/`bug`/`fix`, `read`→`knowledge`/`concept`/`architecture`, `edit`→`convention`/`decision`/`preference`). Impl at `src/storage/search.ts`, `src/storage/queries/nodes.ts`.
- **Dot nodes** (`type: "dot"`, label prefix `dot:`): Graphviz DOT source stored as a memory node. Creation via `memory(mode="set", type="dot", ...)` forces `sticky` (survives compression, `src/storage/queries/nodes.ts`) and skips embedding generation (DOT isn't semantic text, `src/tools/core.ts`) — no vector storage, not retrievable by semantic search (intended: diagrams are browsed, not retrieved). `dot:` labels get the ×1.25 purpose-quality boost (`computeQualityMultiplier`). Management app renders them in-browser: vendored `@viz-js/viz` WASM build at `management/public/vendor/viz-global.js` (script-tag global `Viz`, lazy `Viz.instance()`, `renderSVGElement`), modal at `#dot-modal` (index.html) with flatten-into-container viewBox fitting (app.js `renderDotDiagram`), zoom/pan via CSS transform on `#dot-svg`. ◈ Open Diagram button is injected as the first element of `#detail-content` in `showDetailPanel` — do NOT position it in the header row (absolute positioning collides with close button/title).
- **Purpose-Centric Lessons**: `session.idle` auto-extracts a distilled `lesson` node (type `lesson`, label `lesson:<ts>`, tag `sig:<failed-tools>`) from failed tool calls — ArcticMem-style content (what failed, why, how to avoid). Dedup: skips when a lesson with the same failure signature already exists. Config: `autoLessons {enabled (default true), minFailures (2), useLlm}`. Optional LLM pass generates concrete prevention rules. Impl at `src/application/lesson-extraction.ts`, wired in `src/plugin/hooks/events.ts`. `learn(mode="reflect")` (src/tools/reflect.ts) also creates lessons manually; `distillRules` folds them into `rule:mandatory:memory`.
- **Auto Work Capture** (`autoCapture`): the success-mirror of auto-lessons — at `session.idle`, `captureSessionWork` (src/application/work-capture.ts) distills a `work:<ts>` knowledge node (type `knowledge`, tag `sess:<sessionId>`) from the session's successful edit/write tool calls (files touched + tools used, optional LLM "what was done" summary). So failures become `lesson:` nodes AND completed work becomes `work:` nodes — neither direction of session history is lost. Config: `autoCapture {enabled (default true), minEdits (1), useLlm (false), maxPerSession (3)}`. Dedup: per-session cap via `sess:` tag. Does NOT replace manual `memory(mode="set")` of significant completed work — see `rule:mandatory:what-to-store` (now injected via RULE_LABELS; it previously existed in the DB but was never injected).
- **Compaction capture bounds** (`src/plugin/hooks/compaction.ts`): prevents the recursive middle-term blowup (RSS 9+ GB) — fallback cache fill excludes `middle-term:`/`storedcontext:` labels; capture capped at **12 KB total / 2 KB per entry**; `session.messages` fetch `limit: 20` with `part.text` sliced to 2 KB; storedcontext nodes created with `embedding: null` (no ONNX in the hook). Working-cache content capped at 8 KB (`src/application/cache.ts` `MAX_CACHE_CONTENT_CHARS`). Giant-node cleanup: `bun run scripts/cleanup-giant-nodes.ts --dry-run|--force` (deletes project nodes > 1 MB content).
- **Ranking module** (feature-weighted linear model, replaced RRF): `src/application/ranking/` — `weights.ts` (defaults `semantic 0.5, bm25 0.25, quality 0.15, confidence 0.05, usefulness 0.05` + config `ranking.featureWeights` resolution), `features.ts` (normalized [0,1] features incl. `qualityFeature` from `computeQualityMultiplier`), `fusion.ts` (linear `Σ wᵢ·fᵢ` + absolute normalization, no per-query min-max), `intent.ts` (purpose-type boosts per intent), `pipeline.ts` (`rankCandidates` → calibrated importance; recency = tiebreak only), `rerank/` (keyword + cross-encoder registry). `computeQualityMultiplier` (src/storage/queries/search-helpers.ts) boosts curated purpose labels (`lesson:`/`decision:`/`convention:`/`fact:` ×1.3, `knowledge:`/`rule:`/`skill:` ×1.25, `plan:`/`task:` ×1.1) and demotes `storedcontext` session dumps (×0.5) and `middle-term:`/`[history]` snapshots (×0.6); it feeds the `quality` feature, not a multiplicative tail.
- **Code Graph** (pull-based `graph` tool): relations `callers`, `callees`, `call_chain`, `imports`, `dependents`, `search`, `explain`, `path`. AST knowledge graph via tree-sitter WASM (32 languages), auto-refreshes on edit/write. Plugin + MCP. Impl at `src/tools/graph.ts`, `src/application/graph/`. **WASM extraction runs in fresh subprocesses, never in opencode's process**: `buildGraph`/`incrementalBuildGraph`/`refreshGraphFile` collect pending files and route through `extractInBatches` (`batching.ts`) which spawns `batch-worker.ts` (fresh bun/node process) per 100 files, merging `CodeGraph.toJSON()` results back. This is mandatory: the kreuzberg WASM module leaks linear memory across many distinct files (~160-300) then traps with `Out of bounds memory access`, and running it in-process crashed opencode 3× at RSS 4144MB. Each batch = fresh WASM heap, so the leak is bounded; parent never loads WASM (verified ~91MB RSS). See `docs/bug-report-opencode-oom-crash.md`.
- **Brain Mesh 3D Layout** (management app): Desikan-Killiany atlas brain mesh (70 DK parcels → 5 regions in ~101 KB GLB), vertex-averaged centroids, Fibonacci scattering. Build at `scripts/build-brain-glb.ts`, GLB parser at `management/public/glb-loader.js`. See `docs/threejs/brainregions.md`.
- **TUI sidebar (Fractal Memory box)** (`src/tui.tsx` → `dist/tui.js`, Tier-2 slots `sidebar_content` order 50, palette `/mem`): **OpenCode discovers TUI plugins via `tui.json` — `~/.config/opencode/tui.json` (global, all projects), `<project>/.opencode/tui.json`, `<project>/tui.json` (verified via `strings` on `~/.opencode/bin/opencode` v1.18.19 + `specs/tui-plugins.md` `https://github.com/anomalyco/opencode/blob/master/packages/opencode/specs/tui-plugins.md`); a `tui.json` inside the installed plugin package is NEVER discovered alone.** Server side stays in `opencode.json` `plugin: ["opencode-fractal-memory"]` (`exports["."]` → `dist/plugin.js`, hooks/tools), TUI side in `tui.json` `plugin: ["opencode-fractal-memory"]` (npm spec, resolved via `exports["./tui"]` → `dist/tui.js`, `default export {id,tui}` `src/tui.tsx`). Package declares `oc-plugin: [["server"],["tui"]]` + `engines.opencode ^1.18` + `files: [...,"tui.json"]` so `opencode plugin add opencode-fractal-memory` auto-patches both configs; peer deps `@opentui/core|solid >=0.5.6`. Registration writes the **npm spec** `opencode-fractal-memory` (not a file path — absolute `…/dist/tui.js` entries silently fail) into the relevant `tui.json`: `scripts/dev-install.ts` `ensureGlobalTuiRegistration()` (dev path, symlinks `~/.cache/.../node_modules/opencode-fractal-memory` into `~/.config/opencode/node_modules/` + project `.opencode/node_modules/` so the spec resolves) and `scripts/postinstall.cjs` `registerGlobalTui()` (npm path), both merge-preserving other plugins. `bun run plugin:clean` strips registration + symlinks for fresh-install tests. RESTART required. Verified working 2026-08-24 on v1.18.19 in `~/Documents/projects/wasgehtbesser` (global+local tui.json with npm spec both render the box).
- **Purpose-type migration scripts** (`scripts/reclassify-purpose-nodes.ts` Tier-1 label-prefix → type; `scripts/reclassify-purpose-tier2.ts` Tier-2 id → type for content-classified nodes): reclassify existing nodes to purpose types. Run with `--dry-run` (preview) or `--force` (apply). Pattern source: `scripts/fix-existing-nodes.ts`.
- **SWE-ContextBench retrieval test** (`src/storage/search.swecontext.test.ts`, seeds via `scripts/benchmark/seed-swe-context.ts`): real coding-agent memory eval on SWE-ContextBench Lite — 300 experience tasks (trajectory-derived nodes: reasoning + summary + issue + tool-call trace + touched files, tags `swe:experience`/`swe:file`) seeded from actual Claude Code JSONL sessions; 99 related-task problem statements queried against `SWEContextBench_Relationship.parquet` ground truth (HitRate@K/MRR by repo). Committed dataset + ONNX embedding caches at `tests/dbs/swe-contextbench/` — caches are model-suffixed (`-gte-small`); regenerate via `regenerateEmbeddings`, refresh dataset via `scripts/benchmark/fetch-swe-context.ts`. Baseline (gte-small, 512-token window + chunking, RRF-era): 18.2% HitRate@5 keyword, 39.4% @10; LLM/cross-encoder A/B: 56.6% @5, 66.7% @10 — cross-encoder rerank recovers the quality gap from the smaller embedding model. **After the feature-weighted linear model replaced RRF** (see ranking module below): keyword 77.8% HitRate@5, 83.8% @10; cross-encoder 72.7% @5, 86.9% @10 — the linear model made keyword-mode strong on precision (@5), and the cross-encoder's remaining edge is recall (@10).
- **Cross-encoder rerank** (`rerankMode: "cross-encoder"`): `searchByEmbedding` (src/storage/search.ts) supports a second rerank mode via the local ONNX cross-encoder (`ms-marco-MiniLM-L-6-v2`, `scorePairs` in src/infrastructure/llm/cross-encoder.ts) over a ≥20-candidate pool. No Ollama/network — deterministic CPU. Exposed as `rerank_mode` on the memory search tool (src/tools/search.ts) AND config-driven: `ollama.strategy: "cross-encoder"` sets it as the tool default (threaded via createToolMap → createMemoryTool → MemorySearch → searchNodes → searchByEmbedding). SWE-ContextBench A/B (gte-small): keyword 18.2% → **77.8%** HitRate@5, 39.4% → **83.8%** @10; cross-encoder 72.7% @5, 86.9% @10 (linear-model era — cross-encoder is a recall win at @10, not a precision win at @5). `scorePairs` batches all pairs in one ONNX inference (scores match per-pair within ~2e-5); the model outputs `[N,1]` logits — read `data[b]` per row, NOT a 2-class head. Standalone harness: `scripts/benchmark/eval-ollama-rerank.ts 99 cross-encoder`. Embedding model: gte-small (384-dim, 512-token window, mean pooling) with multi-segment chunking (`embeddings.chunking {enabled, maxSegments=8, includeStoredContext=true}` in config) — long nodes (≤512 tokens/segment) get one HNSW point per segment; revert path is MiniLM via `--revert` in `scripts/reembed-nodes.ts`.

## Codebase Layout

| Directory | Role |
|---|---|
| `src/domain/ports/` | Hexagonal ports — interfaces only (`MemoryStore`, `NodeRepository`, `SessionTracker`, …) |
| `src/storage/` | Persistence: `sqlite.ts` (store), `queries/` (SQL modules), `migrations/` |
| `src/application/` | Domain logic: command-compression, auto-retrieve, graph, injection-visibility, … |
| `src/infrastructure/` | Composition root, config, LLM adapters (ONNX/embeddings/cross-encoder/ollama) |
| `src/plugin/` | OpenCode adapter: `index.ts` (entry), `hooks.ts` (orchestration), `hooks/` (handlers), `tools/` |
| `src/tools/` | Agent-facing tools: consolidated memory/context/learn/journal, graph, mcp |
| `src/management/` | Dashboard server: `routes.ts`, `helpers.ts`, `management-standalone.ts` |
| `management/public/` | Dashboard UI (vanilla JS, Three.js brain mesh) |

## Graph Tool Usage

Before editing a function, use `graph` with `relation=callers name=<function>` to know what depends on it. After finding a symbol, use `relation=callees` or `relation=call_chain depth=3` to trace dependencies. Use `relation=dependents file=<path>` for change impact analysis. All results are JSON with a `truncated` field indicating if results were capped.

## Development Install (critical — cache or it won't work)

**The ONLY location OpenCode ever loads is the plugin cache `@latest` path**: `~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/`. This is beacon-proven (see `PLUGIN_LOADED_FROM` in `~/.config/opencode/logs/memory-plugin.log`) — NOT `~/.config/opencode/node_modules` (legacy, never read by OpenCode). Always use the dev-install script — it builds, cleans, and syncs the cache (the config copy is kept only for npm-pack compatibility):

```bash
bun run dev-install                # build + clean + sync to plugin cache
bun run dev-install --skip-build   # skip tsc, just sync
```

Then **restart OpenCode** — the running process holds the module cache in memory; disk edits have no effect until restart.

What the script does (scripts/dev-install.ts): wipes `~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/` (plus the legacy `~/.config/opencode/node_modules/` copy), copies all top-level files + nested `node_modules/` deps into the cache, symlinks the package into `~/.config/opencode/node_modules/` and `<project>/.opencode/node_modules/` so the TUI `tui.json` npm spec `opencode-fractal-memory` resolves (see TUI bullet above), ensures `tui.json` registration (npm spec, merge-preserving), prints the installed version + a RESTART REQUIRED warning, and fails with a non-zero exit if `dist` is missing from the cache. `scripts/postinstall.cjs` does the same for regular `npm install` consumers.

VS Code: use the "Dev Install Plugin (build+clean+sync)" launch config in `.vscode/launch.json`.

Why only the cache: `npm install`/`npm pack` alone only touches `~/.config/opencode/node_modules` — which OpenCode never loads for the **server** plugin. Only a manual `cp -r` into the cache or `bun run dev-install` reaches the copy OpenCode actually reads. For the **TUI** plugin the npm spec must also resolve via `node_modules` (hence the symlinks). The script removes the manual `cp -r` ritual entirely.

**First-time install (if `@yomguithereal/helpers` or `graphology-indices` errors still occur after `bun run dev-install`):**
```bash
CACHE=~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory
cd "$CACHE"
npm install --no-save graphology graphology-communities-louvain graphology-shortest-path graphology-traversal
```

Then restart OpenCode.

**Verify the live install** (after restart): `grep "PLUGIN_LOADED_FROM" ~/.config/opencode/logs/memory-plugin.log` — the `resolvedDir` must point at the cache `@latest` path. If it points elsewhere (e.g. `~/.config/opencode/node_modules`), the plugin is being loaded from the wrong location.

## Svelte 5 + Skeleton v5 Insights (frontend/ — the SvelteKit parallel at :8788)

Stack proven in this repo: `svelte 5.56.1`, `@sveltejs/kit 2.63`, `@sveltejs/adapter-static 3.0.8 fallback:index.html strict:true`, `vite 8.0.16`, `tailwind 4.2 + @tailwindcss/vite 4.2`, `@skeletonlabs/skeleton 5.0.1 + @skeletonlabs/skeleton-svelte 5.0.0-5.0.1 theme cerberus`, `svelte-i18n 4.0.1`, `three 0.185`, `@viz-js/viz 3.30`. `frontend/bun.lock` is independent — don't hoist to root.

- **Setup**: `frontend/svelte.config.js: compilerOptions runes:true`, `vite.config.ts: defineConfig plugins [tailwindcss(), sveltekit()]`, `src/app.css: @import "tailwindcss"; @import "@skeletonlabs/skeleton"; @import "@skeletonlabs/skeleton-svelte"; @import "@skeletonlabs/skeleton/themes/cerberus";` → 134KB. No SSR for this app — client-only, `src/routes/+layout.ts: import '$lib/i18n'; waitLocale()`.
- **i18n**: `src/lib/i18n/index.ts: register('en') + init fallbackLocale:en`, `src/hooks.server.ts: handle Accept-Language → locale.set`, `+layout.ts: waitLocale() → locale.set`. Single `src/locales/en.json`, `$t('key')` single-brace.
- **Skeleton primitives to prefer**: `AppShell` (`+layout.svelte`) → `AppBar` (`Header.svelte: AppBar Toolbar Lead Trail nav flex btn-sm preset-filled-primary-500 / preset-tonal`) + `Footer.svelte` (year + Alpine:8787/Svelte:8788 badge). Never use `variantFilled` — v5 uses `preset-*`: `preset-filled-primary-500`, `preset-tonal`, `preset-outlined-surface-200`, `preset-filled-surface-100`. `card`, `btn btn-sm`, `badge`, `chip`, `input` (rounded-full `pl-9 pr-20 border-2 focus:border-primary-500`), `select`, `filter-btn` are the workhorses. Horizontal pill layout for filters (not dropdown) — `flex gap-1 flex-wrap`.
- **Runes + Skeleton**: `let { query = $bindable(''), scope = $bindable('all'), layout = $bindable('shell') } = $props()`, `$state`, `$derived`, `$effect` for localStorage persistence (`fractal-visualize` key) + reactive scope switching (`nodesStore.setScope`). Keep OOP for heavy Three logic (`SceneController.ts`, `NodeFilterEngine.ts`, `GraphController.ts`) — don't put Three inside Svelte reactivity, manage via `$effect(() => { void nodes.length; void layout; ctrl.buildFromData(nodes, layout) })`.
- **Patterns that broke and why**: `buildFromData` must branch `if (mode==='brain') showBrainLayout` — flat `computeShell` in brain mode leaves nodes outside GLB; `GLBLoader` must be the custom `glb-loader.ts` port of `management/public/glb-loader.js` (returns `{geometry,name,color}` with region names for centroid re-projection), not `three/addons/loaders/GLTFLoader` (loses names). For smoothing, `mergeVertices + subdivideGeometry + laplacianSmooth(3,0.35) + computeVertexNormals + flatShading:false` rounds the decimated 101KB atlas; plain `computeVertexNormals` alone stays faceted, double midpoint without Laplacian stays edgy.
- **Docs**: Always `svelte_list-sections` → `svelte_get-documentation` + `svelte-autofixer` before sending code; playground links via `svelte_playground-link` only after user confirms and never for files written to `frontend/`.

## Coding Paradigms

- **No `I` prefix on interfaces** — `MemoryStore`, `NodeRepository`, `SessionTracker`
- **`exactOptionalPropertyTypes: true`** — optional params use `param?: Type | undefined`; callers omit, don't pass `undefined`
- **Zod v4 at external boundaries only** — parse at I/O edges (`CreateNodeInput`), not on internal calls (trusted code)
- **`Record<string, unknown>` over `any`** — for dynamic objects; `unknown` for catch clauses, callback params. Exceptions: `wrapWithTracking(toolDef: any)`, `Bun.spawn` flags in `management-server.ts` (no viable type)
- **Hexagonal architecture** — ports in `src/domain/ports/`, implementations in `src/storage/` + `src/infrastructure/`, logic in `src/application/`, adapters in `src/plugin/hooks/`
- **Composition-root** — `src/infrastructure/composition-root.ts`: split by concern (`initializeStore`, `ensureAssets`, `initializeConfig`, `maybeStartManagement`)
- **Interfaces + free functions over abstract classes**
- **Test mocks: typed partials, no `as any`** — use `as unknown as Type` or `Record<string, unknown>`

## Linting, Tests, Rules

```bash
bun run lint              # oxlint — must stay at 0 errors, 0 warnings
bun run lint:fix          # auto-fix (--fix-dangerously)
bun test                  # essential suite — fast by default (~6s, 50 files). The two slow benchmark evals (search.loco.test.ts ~5min, search.swecontext.test.ts ~4min) are excluded via pathIgnorePatterns in bunfig.toml
bun run test:full         # full suite — everything including slow benchmark evals (52 files, ~9min). Uses --path-ignore-patterns 'zz-none' to clear the toml exclusion (CLI replaces toml value entirely)
bun run test:slow         # benchmark evals only — the two slow files (needs the 'zz-none' override too: positional filters can't re-include toml-pruned files)
bun run test:coverage     # coverage run
```

- **Only the cache `@latest` path is ever loaded by OpenCode** (`~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory`) — beacon-proven via the `PLUGIN_LOADED_FROM` startup log (see `memory-plugin.log`). The `~/.config/opencode/node_modules` copy is legacy and never read by OpenCode. Verify installs with `grep -q "<pattern>" "$CACHE/dist/..."`; never hand-copy with `cp -r` — use `bun run dev-install`
- Run `bun run lint` before committing — must be 0 errors, 0 warnings
- Migration version in `definitions.ts` must increment; never modify existing migrations; bump `CURRENT_VERSION` in `src/storage/migrations/index.ts` to match
- After schema migrations that add columns: update ALL explicit SELECT column lists (querySearchText, querySearchBM25) AND mapNode in routes.ts AND NodeLike in helpers.ts AND computeStats aggregations
- When adding new log files: add write function to `src/logging.ts`, register in section map, create file path constant
- `verifyNode` must update both confidence AND verification_count in the same SQL UPDATE — diminishing returns `+0.2/(1+verificationCount)`
- `source` set on ALL node creation: `manual`, `tool_result`, `auto_extract`, `web_search`, `reflection`, `llm_compress`
- Source-of-truth linking: encode verification pointers as tags (`file:`, `fn:`, `commit:`, `line:`, `test:`, `cmd:`) on every node — searchable via `tagsFilter`
- Use the `memory` tool for ALL node CRUD — never bash+sqlite3 (triggers compression overhead)
- Management app config fields: `id` = kebab-case in HTML, load/save in app.js with same pattern
- Strategy names in `strategy.ts` registry entries must be short strings (ls, test, grep, git-status, git-log, git-diff, git-quick, truncate, generic)
- When graph build has silent failures (file nodes << expected), check the `@kreuzberg/tree-sitter-language-pack-wasm` type definitions first — `getParser(name)` **throws** on unknown language, returns parser pre-configured (no `setLanguage`), uses `FinalizationRegistry` for auto-cleanup

## Critical Memory Nodes

`memory(mode="drilldown", label="<label>")` to retrieve full context:

**Project hub** — search `fact:opencode-fractal-memory-hub` FIRST: it maps the project's dynamic memory network (11 children covering storage/query layers, application core, auto-retrieve, ranking, code graph, hooks orchestration, management app, dev-install, config/logging, and the two architecture decisions). Static facts live in this file; the hub indexes the in-memory children.

| Label | Type | Why |
|---|---|---|
| `rule:mandatory:memory` | rule | Memory tool rules (search→get→set chain) |
| `rule:feature:command-compression` | rule | Compression feature details |
| `rule:feature:memory-tool-usage` | rule | Memory tool best practices + source-of-truth linking |
| `rule:feature:auto-retrieve` | rule | Auto-retrieve reranking details |
| `rule:feature:source-propagation` | rule | Source values on node creation |
| `rule:feature:tag-intersection-search` | rule | tagsFilter intersection semantics |
| `rule:feature:confidence-diminishing-returns` | rule | verifyNode 0.2/(1+vc) formula |
| `feat:injection-visibility-complete` | implementation | Markers + digest across 9 surfaces |
| `feat:injection-visibility-dashboard-persist` | implementation | Silent injections → injection_metrics |
| `knowledge:management-app-architecture` | knowledge | Management app structure, API, tabs |
| `implementation-plan` | howto | Graph tool implementation plan |
| `plan:memory-categorization-improvements` | plan | Memory categorization improvement plan |
| `bug:three-bugs-2026-06-15` | fix | Three bugs fixed + root causes |
| `file:src/plugin/hooks.ts` | file | Hook wiring — all features |
| `file:src/management/routes.ts` | file | All API routes |
| `file:src/tools/graph.ts` | file | Shared graph tool (plugin + MCP) |
| `file:management/public/app.js` | file | Management app frontend (brain mesh, 3D scene controller) |
