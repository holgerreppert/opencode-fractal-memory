# opencode-fractal-memory

Plugin providing infinite context memory for OpenCode via SQLite, embeddings, and BM25 hybrid search.

## Architecture

- **Storage**: SQLite (`~/.config/opencode/memory.db`), sqlite-vec (cosine sim), FTS5 (BM25)
- **Hooks**: `tool.execute.before` (skeletonization, re-read elimination), `tool.execute.after` (memory + compression), `experimental.chat.system.transform` (rule injection), `experimental.chat.messages.transform` (auto-retrieve reranking + memory injection), `chat.message` (session ID tracking), `event` (lifecycle)
- **Management app**: Served on `http://localhost:8787`, spawned as subprocess. API at `src/management/routes.ts`, UI at `management/public/`
- **Config**: `~/.config/opencode/opencode-mem.json`, Zod schema at `src/config.ts`
- **Logging**: Per-feature logs at `~/.config/opencode/logs/` — `memory-plugin.log`, `filesum.log`, `compress.log`, `sessionlog.log` (`src/logging.ts`)

## Core Features

**Command Output Compression** (`tool.execute.after`): 7 strategies (`ls`/test/grep/git-status/git-log/git-diff/git-quick/truncate/generic) + structural shape detection (JSON/CSV/stack/tree/table), fuzzy dedup (trigram Jaccard), adaptive pressure (token budget), relevance trimming (TF-IDF), delta compression, output offloading. Impl at `src/hooks/compress-output.ts`.

**Output Token Control** (`experimental.chat.system.transform`): Injects concise-output rule into system prompt based on context pressure. Modes: adaptive/always-on/off. Strategies: concise/sentence_limit/char_limit/bullet_only/custom. Impl at `src/hooks/output-token-control.ts`.

**Re-Read Elimination** (`tool.execute.before` for `read`): Serves cached file content when mtime unchanged. Impl at `src/hooks/re-read-elimination.ts`.

**Auto-Retrieve** (`experimental.chat.messages.transform`): Reranking pipeline with LLM judge scoring (via `client.session.prompt({noReply:true})`), Ollama fallback, ONNX cross-encoder. Impl at `src/hooks/auto-retrieve/`.

**Memory Categorization** (multi-phase): Nodes have `type` → auto-derived `category` (episodic/semantic) + `supertype` (declarative/procedural/experiential/meta). `searchByEmbedding` accepts `intent` (`read`/`edit`/`debug`/`discovery`) for intent-aware biasing. Temporal stratification (hot/warm/cold) penalizes stale nodes. Tags (`string[]`), source provenance, and verification count tracked. Management UI shows all fields. Impl at `src/storage/search.ts`, `src/storage/queries/nodes.ts`, `src/domain/ports/MemoryStore.ts`.

**Code Graph** (pull-based `graph` tool): Navigate code dependencies on demand. Relations: `callers`, `callees`, `call_chain`, `imports`, `dependents`, `search`, `explain`, `path`. Builds AST knowledge graph via tree-sitter WASM (32 languages). Auto-refreshes on edit/write. Available as both plugin tool and MCP tool. Impl at `src/tools/graph.ts`, `src/application/graph/`.

## Graph Tool Usage

Before editing a function, use `graph` with `relation=callers name=<function>` to know what depends on it. After finding a symbol, use `relation=callees` or `relation=call_chain depth=3` to trace dependencies. Use `relation=dependents file=<path>` for change impact analysis. All results are JSON with a `truncated` field indicating if results were capped.

## Development Install (critical — cache or it won't work)

OpenCode loads from plugin cache, NOT from node_modules:

```bash
bun run build && npm pack
cd ~/.config/opencode
npm install --ignore-scripts /path/to/opencode-fractal-memory-0.6.34.tgz
cp -r node_modules/opencode-fractal-memory/{dist,management,package.json,LICENSE,commands,agent} \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

Quick iteration (also copies graphology deps for management server):
```bash
bun run build && \
CACHE=~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory && \
cp -r dist management package.json LICENSE README.md commands agent "$CACHE/" && \
for pkg in graphology graphology-communities-louvain graphology-shortest-path graphology-traversal graphology-utils graphology-indices pandemonium @yomguithereal mnemonist obliterator mitt onnxruntime-node onnxruntime-web; do \
  [ -d "node_modules/$pkg" ] && cp -r "node_modules/$pkg" "$CACHE/node_modules/" 2>/dev/null; \
done
```

**First-time install (if `@yomguithereal/helpers` or `graphology-indices` errors still occur):**
```bash
CACHE=~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory
# Install all graphology deps into the cache plugin's node_modules
cd "$CACHE"
npm install --no-save graphology graphology-communities-louvain graphology-shortest-path graphology-traversal
```

Then restart OpenCode.

## Coding Paradigms

- **No `I` prefix on interfaces** — `MemoryStore`, `NodeRepository`, `SessionTracker` (not `IMemoryStore`)
- **`exactOptionalPropertyTypes: true`** — optional params use `param?: Type | undefined`; callers omit, don't pass `undefined`
- **Zod v4 at external boundaries only** — parse at I/O edges (`CreateNodeInput`), not on internal calls (trusted code)
- **`Record<string, unknown>` over `any`** — for dynamic objects; `unknown` for catch clauses, callback params. Exceptions: `wrapWithTracking(toolDef: any)` (inherently generic), `Bun.spawn` flags in `management-server.ts` (no viable type)
- **Hexagonal architecture** — domain ports (`src/domain/ports/`), infrastructure implementations (`src/storage/`, `src/infrastructure/`), application layer (`src/application/`)
- **Composition-root** — `src/infrastructure/composition-root.ts`: split by concern (`initializeStore`, `ensureAssets`, `initializeConfig`, `maybeStartManagement`)
- **Interfaces + free functions over abstract classes** — `interface MemoryStore`, not `abstract class MemoryStore`
- **Test mocks: typed partials, no `as any`** — use `as unknown as Type` or `Record<string, unknown>`; avoid `as any`
- **`noUncheckedIndexedAccess` skipped** — would require `!` on every `arr[i]` with no real safety gain

## Linting (oxlint)

Uses [oxlint](https://oxc.rs/docs/guide/usage/linter) instead of ESLint — ~100× faster, native TS support, auto-fixes unused imports + variables.

```bash
bun run lint              # check all source files
bun run lint:fix          # auto-fix (--fix-dangerously)
```

Config at `oxlintrc.json`. Overrides suppress test/benchmark noise. **Must stay at 0 errors, 0 warnings.**

## Key Files

| File | Purpose |
|---|---|---|
| `src/config.ts` | MemConfig interface + Zod schema + defaults |
| `src/plugin/hooks.ts` | Thin orchestration — calls 10 extracted handlers |
| `src/plugin/hooks/compression.ts` | Compression handler + feature banner |
| `src/plugin/hooks/skeletonization.ts` | File read skeletonization handler + banner |
| `src/plugin/hooks/seed-rules.ts` | Rule loading + system transform injection |
| `src/plugin/hooks/working-cache.ts` | Working cache population from tool results |
| `src/plugin/hooks/recording.ts` | Memory tool call recording + predictive rating |
| `src/plugin/hooks/compaction.ts` | Middle-term capture + stored context archiving |
| `src/plugin/hooks/events.ts` | Session lifecycle event handling |
| `src/hooks/compress-output.ts` | 7 compression strategies + generic fallback |
| `src/hooks/skeletonize.ts` | Tree-sitter AST skeleton (32 languages) + regex fallback |
| `src/hooks/auto-retrieve/index.ts` | Multi-reasoning reranking pipeline |
| `src/hooks/auto-retrieve/scoring.ts` | Fallback scoring (metadata + keyword overlap) |
| `src/hooks/output-token-control.ts` | Output token control — rule generation |
| `src/hooks/re-read-elimination.ts` | Read cache + mtime check |
| `src/hooks/adaptive-pressure.ts` | Token estimation + pressure phase tracking |
| `src/infrastructure/llm/onnx-runtime.ts` | ONNX runtime adapter — tries onnxruntime-node first, falls back to onnxruntime-web |
| `src/infrastructure/llm/embeddings.ts` | ONNX embedding model (all-MiniLM-L6-v2, 384d) |
| `src/infrastructure/llm/cross-encoder.ts` | ONNX cross-encoder reranker (ms-marco-MiniLM-L-6-v2) |
| `src/storage/sqlite.ts` | SqliteMemoryStore class |
| `src/storage/migrations/definitions.ts` | DB migrations (increment version, never modify existing) |
| `src/logging.ts` | Per-feature logging functions |
| `src/storage/queries/nodes.ts` | Node CRUD — Zod schema, TYPE_CATEGORY, TYPE_SUPERTYPE, TYPE_METADATA maps |
| `src/storage/search.ts` | searchByEmbedding with intent biasing, temporal stratification, BM25 hybrid |
| `src/management/routes.ts` | All API route handlers |
| `src/management/helpers.ts` | withDb, rowToNode, JSON serialization |
| `src/management-standalone.ts` | Management server entry point (subprocess) |
| `management/public/index.html` | Management app HTML |
| `management/public/app.js` | Management app JS |

## Rules

- Always cp to BOTH node_modules AND cache when installing
- After `cp -r dist "$CACHE/"`, verify the change landed: `grep -q "pattern" "$CACHE/dist/..."` 
- Run `bun run lint` before committing — must be 0 errors, 0 warnings
- Migration version in `definitions.ts` must increment; never modify existing migrations
- Management app config fields: `id` = kebab-case in HTML, load/save in app.js with same pattern
- Strategy name in compress-output.ts must be a short string (ls, test, grep, git-status, git-log, git-diff, git-quick, truncate, generic)
- Skeletonize strategy in skeletonize.ts: `ast-only`, `regex-only`, or `ast+regex`
- When graph build has silent failures (file nodes << expected), check the `@kreuzberg/tree-sitter-language-pack-wasm` type definitions (`*.d.ts`) and docs first — `getParser(name)` **throws** on unknown language, returns parser pre-configured (no `setLanguage` needed), module uses `FinalizationRegistry` for auto-cleanup
- When adding new log files: add write function to `src/logging.ts`, register in section map, create file path constant
- When adding columns to `memory_nodes`, update ALL explicit SELECT column lists (querySearchText, querySearchBM25) or rowToNode will break
- After schema migrations, update mapNode in routes.ts to include new fields for management API
- `verifyNode` must update both confidence (+0.2) AND verification_count (+1) in the same SQL UPDATE

## Critical Memory Nodes

`memory_drilldown(label="<label>")` to retrieve full context:

| Label | Type | Why |
|---|---|---|
| `knowledge:management-app-architecture` | knowledge | Full management app structure, API, tab system |
| `auto-retrieve-status` | summary | Auto-retrieve pipeline state, scores, config |
| `implementation-plan` | howto | Full architectural improvement plan (all phases) |
| `architectural-review-plan` | howto | Architecture scoring, bottlenecks, recommendations |
| `bug:three-bugs-2026-06-15` | fix | Three bugs fixed + root causes |
| `rule:mandatory:memory` | rule | Memory tool rules (search→get→set chain) |
| `rule:mandatory:agent-pull` | rule | No auto-injection |
| `rule:feature:command-compression` | rule | Compression feature details |
| `rule:feature:file-skeletonization` | rule | Skeletonization feature details |
| `rule:feature:auto-retrieve` | rule | Auto-retrieve reranking details |
| `rule:feature:tag-intersection-search` | rule | tagsFilter option in searchByEmbedding — intersection semantics |
| `rule:feature:source-propagation` | rule | Source must be set on ALL node creation — values table |
| `rule:feature:confidence-diminishing-returns` | rule | verifyNode uses 0.2/(1+vc) formula |
| `output-token-control` | howto | Output token control — config, strategies, levels |
| `sdk-llm-judge-auto-retrieve` | note | LLM judge via client.session.prompt({noReply:true}) |
| `memory-llm-compress-session-fix` | note | sessionId threading fix for memory_llm_compress |
| `enhancements-llm-compress-auto-distill-predictive-rating` | note | Three enhancements implementation |
| `ollama-memory-feature` | note | Ollama-based local memory system |
| `middle_term_context_implementation_complete` | implementation | Middle-term context capture |
| `injection-scoring-improved` | note | Improved injection scoring with relevance-budget selector |
| `auto-retrieve-fix-complete` | note | Auto-retrieve fix details |
| `file:src/plugin/hooks.ts` | file | Hook wiring — all features |
| `file:src/hooks/compress-output.ts` | file | Compression implementation |
| `file:src/management/routes.ts` | file | All API routes |
| `file:src/tools/graph.ts` | file | Shared graph tool (plugin + MCP) |
| `file:src/plugin/hooks/graph-refresh.ts` | file | Auto-refresh on edit/write |
| `file:src/application/graph/query.test.ts` | file | Tests for callers/callees/callChain |
| `plan:memory-categorization-improvements` | plan | Full memory categorization improvement plan (project scope) |
| `pattern:multi-phase-implementation` | pattern | Batch implementation pattern for multi-file schema changes |
| `feat:source-propagation` | implementation | Source auto-fill in compaction/compress/lifecycle creation sites |
| `feat:confidence-diminishing-returns` | implementation | verifyNode uses 0.2/(1+vc) instead of flat +0.2 |
| `feat:tag-intersection-search` | implementation | tagsFilter option in searchByEmbedding with tag intersection filtering |
| `feat:management-dashboard-charts` | implementation | Supertype/tag cloud/confidence histogram/stratum breakdown cards |
| `feat:management-tag-editing` | implementation | Inline tag add/remove and source dropdown in detail panel |
| `file:management/public/app.js` | file | Full management app frontend (3393+ lines, vanilla JS) |
| `file:src/management/helpers.ts` | file | Stats computation, rowToNode, computeStats with new aggregations |

## Rules

- `source` should be set on ALL node creation: `manual` for user-initiated, `tool_result` for tool output, `auto_extract` for automatic capture, `web_search` for web results, `reflection` for agent reflection, `llm_compress` for compression summaries
- After schema migrations that add columns, update ALL explicit SELECT column lists (querySearchText, querySearchBM25) AND mapNode in routes.ts AND NodeLike in helpers.ts AND computeStats aggregations
- Management UI chart data flows: backend computeStats → StatsResult → /api/stats → app.js buildDashboardCharts() → DOM
- Tag editing pattern: inline DOM manipulation + PUT /api/nodes/:id with {tags: [...]} + showDetailPanel refresh
