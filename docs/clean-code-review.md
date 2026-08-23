# Clean Code Review — opencode-fractal-memory

**Scope**: `src/` (excl. `src/management/`, `management/public/`, `src/tools/mcp.ts`, MCP wiring).
**Method**: two parallel evidence scans (LOC census, import-graph check, catch-block audit, hook-map extraction) + targeted verification of every claim below. All numbers reproducible via the commands cited.
**Baseline**: branch `feat/retrieval-explain-ui:4d2b5f5` (main `0e41064`, schema v36).

---

## 1. Verdict

| Dimension | Grade | Evidence |
|---|---|---|
| Layering / hexagonal discipline | **A−** | Zero `../storage` imports from `plugin/`, `application/`, `domain/`, `tools/`; `bun:sqlite` appears **only** in `src/storage/*` and `src/infrastructure/db/DbProvider.ts:4` (plus tests) |
| Naming & conventions | **A** | No `I`-prefix, `exactOptionalPropertyTypes`, Zod only at boundaries, `Record<string, unknown>` discipline (oxlint 0/0) |
| Observability | **B−** | Per-feature `memLog` + pipeline provenance are strong; **~95 silent `catch {}` blocks without comments** undermine it |
| Single Responsibility | **C+** | `seed-nodes.ts` (1533 L data-as-code), `config.ts` (731 L single Zod tree), `search.ts` (556 L full pipeline in one module) |
| Testability | **B** | 50-file essential suite ~6 s; but largest test file `sqlite.test.ts` 1615 L is a god-test |

**Overall: structurally sound, with three concrete debt clusters — silent error swallowing, data-in-code, and monolithic retrieval/config modules.** The earlier concern "hooks import storage directly" was **not confirmed** — the priority-ordered `ToolResultTransformer` pipeline (`tool-result-pipeline.ts`) is exactly the right pattern.

---

## 2. Findings (verified)

### F1 — Silent catches erode the observability investment  · **major**
`rg -o "catch \{" src -g '!*.test.ts' | wc -l` → **156**, of which only **61** carry an explanatory comment. ~95 swallow errors with no `memLog` breadcrumb — directly against the project rule "all storage/mgmt/TUI changes logged via `memLog`".
Hotspots: `src/application/auto-retrieve/index.ts`, `src/application/ranking/pipeline.ts`, `src/application/search.ts`, `src/infrastructure/llm/cross-encoder.ts`.
*Fix*: mechanical sweep — replace bare `catch { /* ignore */ }` with `catch (e) { memLog("warn", "<feature>", "...", {error}) }`, or at minimum a `/* expected: <why> */` tag; add oxlint rule `no-empty-catch` scoped to warn.

### F2 — `seed-nodes.ts`: 1533 lines of content compiled as code  · **major**
Seed memory content lives in TS string literals → parsed on every build, uneditable by the management app, un-diffable as data.
*Fix*: move to `src/seeds/*.json` + a ~40-line loader; keeps type-safety via one Zod parse at load.

### F3 — `config.ts` god-schema (731 L)  · **major**
One Zod object mixes ranking weights, compression tiers, auto-retrieve phases, ollama, injection visibility, lessons, capture…
*Fix*: split per feature (`configSchema = merge(rankingSchema, compressionSchema, …)`); each feature file owns its slice. Unblocks Phase-5 "config grouped by user goals".

### F4 — `storage/search.ts` (556 L) spans five pipeline stages  · **major**
Candidate union, hybrid scoring, temporal expansion, rerank dispatch, and MMR live in one module. Ranking math itself is well-factored into `application/ranking/{weights,features,fusion,intent,pipeline,rerank}` — the storage layer re-couples them.
*Fix*: extract stage functions (`generateCandidates`, `fuseScores`, `selectDiverse`) inside `search.ts` or promote to `application/retrieval/`; enables the `dryRun=1` trace API cleanly.

### F5 — God test `sqlite.test.ts` (1615 L)  · **minor**
Slow to localize failures; split per store concern (nodes/links/sessions/provenance/index_state).

### F6 — `definitions.ts` holds all 36 migrations inline (728 L)  · **minor**
Convention is documented and safe (append-only, version-bumped), but per-version files (`migrations/v036-index-state.ts`) would shrink diff noise. Low urgency.

### F7 — Optimization hooks not toggleable  · **minor**
14 transformers run unconditionally (`priorities 5→80`, all `applied` in logs even when no-op). `fractal.txt:398` asks for correctness/opt separation.
*Fix*: `config.features.<name>.enabled` gate checked in each transformer's `applies()`.

### Non-findings (checked, clean)
- **No layering leaks**: plugin/app/domain/tools never import `storage/` directly; composition flows through ports.
- **HNSW/graph persistence** is atomic (`tmp.pid → rename`) with `index_state (scope,index_type) PK` manifest v36 — verified schema matches docs.
- **WASM isolation**: graph extraction spawns fresh subprocess batches (`graph/batching.ts` + `worker`) — parent stays ~91 MB RSS.
- **Ports surface** is right-sized: `MemoryStore, NodeRepository, SessionTracker, ConfigPort, ToolRegistry, CompressionPort`.

---

## 3. Priority roadmap

1. **Silent-catch sweep** (~half day, mechanical) → biggest observability win.
2. **Seeds → JSON** (~1 h) → removes largest file in repo.
3. **Config split** (~half day) → prepares feature toggles (F7) and dry-run UX.
4. **Retrieval staging** (1–2 d) → unlocks `/api/search?dryRun=1` explain UI already planned on this branch.
5. Optional: god-test split, per-version migration files.

---
*Verification commands*: `find src -name '*.ts' ! -name '*.test.ts' | xargs wc -l | sort -rn`; `rg -o "catch \{" src -g '!*.test.ts' | wc -l`; `rg -n "../storage" src/plugin src/application src/domain src/tools`; `grep CURRENT_VERSION src/storage/migrations/index.ts` → 36.
