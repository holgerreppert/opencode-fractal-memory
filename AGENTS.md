# opencode-fractal-memory

Plugin providing infinite context memory for OpenCode via SQLite, embeddings, and BM25 hybrid search.

## Architecture

- **Layers**: domain ports (`src/domain/ports/` — interfaces only) ← infrastructure (`src/storage/`, `src/infrastructure/`) ← application logic (`src/application/`) ← plugin adapters (`src/plugin/hooks/`). Composition root at `src/infrastructure/composition-root.ts` wires everything.
- **Storage**: SQLite (`~/.config/opencode/memory.db`), sqlite-vec (cosine sim), FTS5 (BM25)
- **Hooks** (`tool.execute.before`/`after`, `experimental.chat.system.transform`, `experimental.chat.messages.transform`, `chat.message`, `event`): ~20 extracted handlers in `src/plugin/hooks/`, orchestrated by `src/plugin/hooks.ts`
- **Management app**: served on `http://localhost:8787`, spawned as subprocess. API at `src/management/routes.ts`, UI at `management/public/`
- **Config**: `~/.config/opencode/opencode-mem.json`, Zod schema at `src/infrastructure/config/config.ts`
- **Logging**: per-feature logs at `~/.config/opencode/logs/` — `memory-plugin.log`, `compress.log`, `sessionlog.log`, `graph-usage.log` (`src/logging.ts`)

## Features

- **Command Output Compression** (`tool.execute.after` for `bash`): tiered pipeline (verbatim pass-through below thresholds, net-win gate, benign/error-aware), payload-preserving strategies (grep/ls/git-status/table), structural shape detection, fuzzy dedup, delta compression, output offloading. Always reversible — original stashed with `[Original stashed — cat <path>]` marker. Impl: `src/application/command-compression/pipeline.ts` (orchestration), `strategy.ts` (registry), `strategies/`, `output-types/`; hook at `src/plugin/hooks/compression.ts`.
- **Output Token Control** (`experimental.chat.system.transform`): injects concise-output rule based on context pressure. Modes: adaptive/always-on/off; strategies: concise/sentence_limit/char_limit/bullet_only/custom. Impl at `src/application/output-token-control.ts`.
- **Re-Read Elimination** (`tool.execute.before` for `read`): serves cached file content when mtime unchanged. Impl at `src/application/re-read-elimination.ts`.
- **Auto Graph Hints** (`tool.execute.after` for `grep`/`glob`/`search`): appends up to 3 symbol suggestions as a `[code-graph-search-hint]` block. Impl at `src/plugin/hooks/graph-search-hint.ts`.
- **Auto-Skeletonize on Large Reads** (`tool.execute.after` for `read`): generates skeleton via `extractSkeleton` for files ≥ `autoSkeletonizeMinLines` (default 300). Impl at `src/plugin/hooks/graph-context.ts`.
- **Auto-Retrieve** (`experimental.chat.messages.transform`): reranking pipeline (LLM judge via `client.session.prompt({noReply:true})`, Ollama fallback, ONNX cross-encoder). Pressure-aware injection: aggressive phase filters importance ≥ 0.6, critical ≥ 0.8. Impl at `src/application/auto-retrieve/`.
- **Injection Visibility**: every injection surface emits `[memory-plugin:<feature>]` inline markers + a per-turn digest summary message, and persists to `injection_metrics` (so previously-silent injections — re-read, compression, graph-context — appear in the management live feed). Config: `injectionVisibility {enabled, markers, digest}` (all default true). Impl: `src/application/injection-visibility.ts`, `src/plugin/hooks/injection-digest.ts`.
- **Memory Categorization**: nodes have `type` → `category` (episodic/semantic) + `supertype` (declarative/procedural/experiential/meta). `searchByEmbedding` accepts `intent` (read/edit/debug/discovery) with temporal stratification, entity boosting, and purpose-type boosting (`debug`→`lesson`/`bug`/`fix`, `read`→`knowledge`/`concept`/`architecture`, `edit`→`convention`/`decision`/`preference`). Impl at `src/storage/search.ts`, `src/storage/queries/nodes.ts`.
- **Purpose-Centric Lessons**: `session.idle` auto-extracts a distilled `lesson` node (type `lesson`, label `lesson:<ts>`, tag `sig:<failed-tools>`) from failed tool calls — ArcticMem-style content (what failed, why, how to avoid). Dedup: skips when a lesson with the same failure signature already exists. Config: `autoLessons {enabled (default true), minFailures (2), useLlm}`. Optional LLM pass generates concrete prevention rules. Impl at `src/application/lesson-extraction.ts`, wired in `src/plugin/hooks/events.ts`. `learn(mode="reflect")` (src/tools/reflect.ts) also creates lessons manually; `distillRules` folds them into `rule:mandatory:memory`.
- **Purpose-based search ranking**: `computeQualityMultiplier` (src/storage/queries/search-helpers.ts) boosts curated purpose labels (`lesson:`/`decision:`/`convention:`/`fact:` ×1.3, `knowledge:`/`rule:`/`skill:` ×1.25, `plan:`/`task:` ×1.1) and demotes `storedcontext` session dumps (×0.5) and `middle-term:`/`[history]` snapshots (×0.6) in RRF final scoring.
- **Code Graph** (pull-based `graph` tool): relations `callers`, `callees`, `call_chain`, `imports`, `dependents`, `search`, `explain`, `path`. AST knowledge graph via tree-sitter WASM (32 languages), auto-refreshes on edit/write. Plugin + MCP. Impl at `src/tools/graph.ts`, `src/application/graph/`.
- **Brain Mesh 3D Layout** (management app): Desikan-Killiany atlas brain mesh (70 DK parcels → 5 regions in ~101 KB GLB), vertex-averaged centroids, Fibonacci scattering. Build at `scripts/build-brain-glb.ts`, GLB parser at `management/public/glb-loader.js`. See `docs/threejs/brainregions.md`.

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
cd "$CACHE"
npm install --no-save graphology graphology-communities-louvain graphology-shortest-path graphology-traversal
```

Then restart OpenCode.

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
bun test                  # full suite (35 files, 529 tests) — skip search.loco.test.ts (needs pre-seeded DB)
```

- Always cp to BOTH node_modules AND cache when installing; verify with `grep -q "<pattern>" "$CACHE/dist/..."`
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
