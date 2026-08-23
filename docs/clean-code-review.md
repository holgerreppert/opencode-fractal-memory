# Clean Code Review — opencode-fractal-memory (excl. management app & MCP)

Scope: `src/` only — `src/management/` and `src/tools/mcp.ts` excluded. Branch `feat/retrieval-explain-ui:0e41064` (v36, `index_state` + HNSW `tmp→rename` + graph `temp-swap`). Based on prior `fast` scan + `fact:opencode-fractal-memory-hub` + `research:clean-architecture-2026-06-25`.

## Executive Summary
Codebase is feature-rich (~150 files, ~18k LOC) with strong safeguards (hybrid retrieval, bounded compaction, subprocess WASM batching at `src/application/graph/batching.ts`). Primary clean-code risk is **coupling around `SQLiteStore` + `plugin hooks`** and **SRP violations in application services** — not missing functionality. Layering `domain/ports → storage → application → plugin` is declared (AGENTS.md) but leaks: hooks import `storage` directly, ranking mixes scoring with I/O, and神 objects (`sqlite.ts`, `hooks.ts`) centralize unrelated duties.

Overall: **PASS with structural debt** — reliability/observability well-addressed (`pipeline`, `index_state`, `ranking trace`), memory correctness next.

## Top 15 Findings

| # | File:Line | Severity | Issue | Why / Suggestion |
|---|-----------|----------|-------|-----------------|
| 1 | `src/storage/sqlite.ts:60-250, 212` | **critical** | God object `SqliteMemoryStore` (store + migrations + caching + HNSW wiring + index_state updater) | Violates SRP. Split: `SqliteStore` (CRUD) + `IndexStateRepository` (v36 manifest) + `StoreFactory` (composition). Keep `src/storage/queries/` but move updater wiring to `infrastructure/db`. |
| 2 | `src/plugin/hooks.ts:100-130` | **critical** | Massive `HookHandler[]` array, implicit ordering, mixed concerns (compression, graph, pressure, visibility) | Coupling. Keep `ToolResultContext` pipeline (`src/plugin/tool-result-pipeline.ts` already) as single source of ordering; `hooks.ts` should only register transformers with `priority`. |
| 3 | `src/storage/search.ts:280-310` | **major** | `rankCandidates` / `searchByEmbedding` long function (>150L) mixes candidate union, scoring, rerank, MMR, logging | SRP. Extract `candidateGeneration()`, `scoring()`, `diversity()` stages per fractal staged-retrieval proposal. |
| 4 | `src/application/ranking/pipeline.ts:70-120` | **major** | Ranking mixes pure scoring with `memLog` + embedding fetch | Pure function should return `RankComponents` + `trace`; logging at call site. Enables Mgmt UI dry-run. |
| 5 | `src/application/auto-retrieve/candidates.ts:58` | **major** | Long function >200L coupling `storage` imports + pressure logic | Extract `PressurePolicy` + `CandidateProvider` port. |
| 6 | `src/application/graph/build.ts:150,200` | **major** | `buildGraph` couples file walk + `migrations` + `refreshGraphFile`; `ensureBackgroundGraph` mutates global + persists | Separate `GraphBuilder` (pure) vs `GraphCache` (persist `tmp→rename`); temp-swap clone already fixes atomicity but still leaks `backgroundGraph` global. |
| 7 | `src/application/cache.ts:45` | **major** | Global mutable `workingCache` exposed | Encapsulate behind `WorkingCacheRepository` with bounded `8KB` + LRU already, but expose via port not global. |
| 8 | `src/domain/ports/MemoryStore.ts:45` | **major** | `MemoryStore` exposes mutable state / broad `any` in `wrapWithTracking` | DIP violation. Narrow interface: `get/search/insert/update` + `Record<string,unknown>` not `any`. |
| 9 | `src/application/lesson-extraction.ts:120` | **major** | Extraction + persistence merged | Split `LessonExtractor` (pure) vs `LessonRepository`. |
| 10 | `src/application/work-capture.ts:95` | **major** | Capture + compression mixed | Same split as lesson. |
| 11 | `src/application/injection-visibility.ts:30` | **minor** | Visibility logging mixed with core injection | Move to decorator `withVisibility()`. |
| 12 | `src/application/adaptive-pressure.ts:65` | **minor** | Pressure check + injection together | Extract `PressureStrategy`. |
| 13 | `src/application/output-token-control.ts:70` | **minor** | Token control + logging | Separate `TokenBudgetPolicy`. |
| 14 | `src/domain/ports/NodeRepository.ts:30` | **minor** | Duplicate `findByTag` logic | Consolidate via `querySearchText` + `tagsFilter`. |
| 15 | `src/application/command-compression/pipeline.ts` | **minor** | Pipeline registers `ls/test/grep/git-*` strategies but `strategy.ts` names not validated | Add `Zod` at registry entry (external boundary). |

## Coupling & Layering

- **Declared:** `domain/ports ← infrastructure ← application ← plugin` (`AGENTS.md: Hexagonal`). **Actual:** `plugin/hooks` imports `storage` + `infrastructure/vector/hnsw-index.ts` directly (see `sync-pressure.ts` `scopeDbPath` exception). Fix: inject `MemoryRepository`/`NodeRepository` via `composition-root.ts`.
- **Process boundary:** `management` and `plugin` share SQLite file (`~/.config/opencode/memory.db`) with `index_state` manifest — now atomic (`tmp→rename`) but no `project sharding` for large repos (Phase4 deferred).
- **Hook interference:** 14 transforms (`priorities 5→80` in `tool-result-pipeline.ts`) now explicit and logged (`__pipelineProvenance` + `memLog pipeline`), but optimization hooks still not disableable per `fractal.txt` proposal.

## Actionable Roadmap

**Quick wins (1-2 days, no breaking change):**
1. Move `SqliteMemoryStore` `index_state` updater to `src/storage/queries/index-state.ts` (already wired via `setHnswIndexStateUpdater` — extract).
2. Expose `RankComponents` trace via `GET /api/search?dryRun=1` (stage retrieval) — planned for `feat/retrieval-explain-ui`.
3. Add `status:proposed→approved` promotion button in `management/public/app.js` detail panel (uses existing `PUT /api/nodes/:id` `status`).

**Structural (1-2 weeks):**
4. Split `sqlite.ts` god object; enforce `MemoryRepository` only touches SQLite.
5. Stage retrieval: `scope→candidate (BM25/vector/graph) → union → lightweight score → rerank (cross-encoder) → MMR diversity → explanation` (see `fractal.txt:208-224`).
6. Make optimization hooks toggleable (`config.features.*.enabled`) with health check `/api/health` (index revision vs manifest).

**Deferred (per user):** graph DB, predictive prefetch, sleep consolidation, fine-tuned embeddings — intentionally not re-litigated.

## Verification

- `bun run lint` — 0 errors (oxlint).
- `bunx tsc --noEmit` — 0 errors (`exactOptionalPropertyTypes`, no `I` prefix).
- Tests — `667 pass` (synthetic `search.swecontext` baseline ~18% HitRate, cross-encoder `72%` @10).
