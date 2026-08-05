# Changelog

## v0.7.13
- **Purpose-centric lessons** (`src/application/lesson-extraction.ts`, wired in `src/plugin/hooks/events.ts`): at `session.idle`, failed tool calls are distilled into a `lesson` node (type `lesson`, label `lesson:<ts>`, tag `sig:<failed-tools>`) capturing what failed, on which files, and how to avoid it. ArcticMem-style dedup — a lesson whose failure signature already exists is skipped. Config `autoLessons {enabled: true, minFailures: 2, useLlm: false}`; optional LLM pass generates concrete prevention rules. `learn(mode="reflect")` lessons are now `type: "lesson"` instead of `note`.
- **Purpose-based search ranking** (`src/storage/queries/search-helpers.ts`): new `computeQualityMultiplier` applied to final RRF importance — boosts curated purpose labels (`lesson:`/`decision:`/`convention:`/`fact:` ×1.3, `knowledge:`/`rule:`/`skill:` ×1.25, `plan:`/`task:` ×1.1) and demotes `storedcontext` session dumps (×0.5) and `middle-term:`/`[history]` snapshots (×0.6). Distilled knowledge now outranks raw session noise in every downstream consumer (pressure-aware injection ≥0.6/≥0.8, drilldown, management UI).
- **Intent-aware retrieval** (`src/storage/search.ts`): `computeIntentWeight` gains purpose-type boosting per intent — `debug`→`lesson`/`bug`/`fix`/`debug-investigation`, `read`→`knowledge`/`concept`/`architecture`, `edit`→`convention`/`decision`/`preference` (×1.4 each).
- **`lesson` type in public model** (`src/domain/ports/MemoryStore.ts`): `MemoryNodeType` union + `TYPE_CATEGORY` mapping gain `lesson` (semantic). `type` was already a free string at the storage boundary, so no migration was required.
- **Seed rule `rule:feature:auto-lessons`**: injected with the rules every session so the agent learns the lesson capability — how lessons are extracted and how to query them (`debug` intent prioritizes `lesson:`/`bug:`/`fix:`).
- **Existing-node reclassification** (`scripts/reclassify-purpose-nodes.ts`, `scripts/reclassify-purpose-tier2.ts`): 155 existing nodes manually migrated to purpose types — 39 null-type nodes with declaring label prefixes (deterministic), 89 null-type content nodes + 27 mislabeled notes classified by content (knowledge 20→52, research 33→46, plan 32→55, fix 13→27, bug 8→18, howto 7→16, …). System `rule:*` seeds intentionally left untyped (injected by label).
- **Injection visibility** (`src/application/injection-visibility.ts`, `src/plugin/hooks/injection-digest.ts`): every injection surface emits `[memory-plugin:<feature>]` inline markers + a per-turn digest summary message, persisted to `injection_metrics` — previously-silent injections (re-read, compression, graph-context) now appear in the management live feed. Config: `injectionVisibility {enabled, markers, digest}` (all default true).
- **`searchNodes` facade** (`src/application/search.ts`): unified string-first search entrypoint (`mode: hybrid|bm25|text`) with embed-failure/empty fallback to BM25, used by the `memory(mode="search")` tool. Tests: 6 new facade tests (mock store — dispatch, fallback, option pass-through).
- Tests: 558 pass (was 552) across 40 files; lint 0 errors; build clean. Only pre-seeded-DB LoCoMo test skipped (documented).

## v0.7.12
- **Compression module refactor** (`src/application/command-compression/`): The monolithic `command-compression.ts` is now a thin re-export barrel; orchestration moved to `pipeline.ts`, strategy dispatch to a registry (`strategy.ts`, 12 entries: ls, test, grep, git-status, git-log, git-diff, 4× git-quick, truncate), `git pull` extracted to `strategies/git.ts`, output-type detection/compression split into `output-types/{detect,compress,types,index}.ts`, and `utils.ts` split into `utils/{text,signal,scoring,abbreviate}.ts`. No behavior change — verified by unchanged 89-test baseline.
- **Skeletonize fix** (`src/application/skeletonize.ts`): skeleton walk now collects top-level symbols only (`depth === 0`). Previously arrow-function parameters (`p`, `l`, `d`, …) from tree-sitter nested function nodes polluted the skeleton output.
- **git status porcelain support** (`strategies/git.ts`): `compressGitStatus` now parses porcelain v1 output (` M file`, `?? file`, `A  file`) keeping file paths + status markers. Previously porcelain output produced an empty compressed result.
- **Empty-output guard** (`pipeline.ts`): the `accepts()` net-win gate now rejects empty/whitespace candidates — a strategy returning `""` can no longer be accepted as a "compressed" result (would destroy the payload).
- **Comprehensive compression tracing** (`pipeline.ts`, `src/plugin/hooks/compression.ts`): info-level `compress` logs for every gate bail (`skip reason=…`), `strategy-ran`, `strategy-rejected-net-win`, `shape-ran`, `relevance-ran`, `generic-ran`, `compressed`, `hook-enter`, `hook-skip`, `session-cache-hit`. Replaces the old debug-level logs that were invisible at the default `info` log level.
- Tests: 91 pass (was 89) — new regression tests for porcelain git-status and the empty-output guard.

## v0.7.11
- **Payload-preserving strategies exempt from `isSignalOutput` gate** (`src/application/command-compression.ts`): grep/rg, ls, tree, git, and test-runner output containing error words (e.g. matched lines like `memLog("error", …)`) was never compressed because the signal gate ran before strategy dispatch. The command prefix is now computed first; payload-preserving commands bypass the gate since they keep answer lines by design (matched lines / filenames / file lists / failures). Lossy strategies (generic/truncate/shape) remain gated so real errors still pass through verbatim.
- Tests: 89 pass (was 88) — new regression test "grep with error-bearing matches still compresses".

## v0.7.10
- **Tiered command compression** (`src/application/command-compression.ts`, strategies in `src/application/command-compression/`): Replaces the flat "compress everything large" model with graduated tiers:
  - **Tier 0 — verbatim pass-through**: Outputs under `verbatimBelowLines` (default 40) or < 80 chars are never compressed. Small `ls`/`grep`/`git status` results arrive intact.
  - **Net-win gate**: Compression is skipped unless BPE-estimated token savings clear `netWinMinTokens` (default 24) — no net-loss invocations.
  - **Benign-aware threshold**: Clean output compresses only beyond `benignThreshold` (1000 lines); error-bearing output beyond `errorThreshold` (500). Error output always passes through verbatim (`isSignalOutput`).
  - **grep** (`strategies/grep.ts`): Matched lines kept verbatim up to `keepMatches` (15); beyond that, first 15 matched lines + per-file counts + "… +N more". Strict `path:line:content` detection rejects ps/table-style lines (fixes the "no-ext: 1 file, 5 77916996 1229920 pts/0 Sl+" garble).
  - **ls** (`strategies/ls.ts`): Filenames kept verbatim up to `keepNames` (50); never folded to bare "N files". `tree` shares this path.
  - **git status** (`strategies/git.ts`): Changed-file list is the payload and is always kept (up to 50 files + "… +N more"); only headers/instructions are stripped. Fixes a pre-existing trim bug that silently dropped the file list.
  - **tables** (`shape.ts`): Header + rows kept verbatim up to `keepRows` (20); token-count-based table detection replaces the 2+space heuristic that misread `ps aux` as 1 column. Optional per-command `essentialColumns` column trimming.
  - **Always-reversible** (`src/plugin/hooks/compression.ts`): Original output stashed on *every* compression (was > 2000 chars only) with `[Original stashed — cat <path>]` recovery marker. New `[ids_preserved: …]` factsheet lists SHAs/UUIDs/versions dropped by lossy summaries.
  - **Path-safe abbreviations** (`utils.ts`): `applyWordAbbreviations` never rewrites tokens containing `/`, `.`, or `:` — fixes the `src/management/…` → `src/mgmt/…` path corruption.
- **Config**: New `commandCompression` knobs — `netWinMinTokens`, `verbatimBelowLines`, `benignThreshold`, `errorThreshold`, `keepMatches`, `keepNames`, `keepRows`, `essentialColumns` (all with defaults, overridable in `opencode-mem.json`).
- Tests: 88 pass (was 79); lint 0 errors; build clean.

## v0.7.8
- **Management app — no external CDN dependencies**: Alpine.js vendored locally (`alpine.local.js`, was loading from jsdelivr and blocked by adblockers/firewalls); chart.js and fuse.js still load from CDN but no longer block app boot. Fixes node list, dashboard, search, and filters rendering when the CDN is unreachable.
- **Management app — live agent feed**: New unified timeline merging conversation turns, tool calls, injections, and compressions into a single sortable/filterable feed. Chat-style ordering (newest at bottom with auto-scroll to newest — fixes newest entries being rendered off-screen above the viewport). Polls `/api/live` every 2s. Live Metrics tab shows injections, compressions, tool calls, and token history.
- **Management app — tab grouping**: Tabs reorganized into Monitor / Data / Live / System groups. Dashboard split into Memory Distribution + Quality Metrics sections.
- **Management app — fixes**: duplicate `escHtml` definition removed; mouse NDC coordinates corrected (was offset by the 280px sidebar, breaking brain/3D region picking); node list fallback without Alpine internals.
- **Live capture fallback** (`src/plugin/hooks.ts`, `src/plugin/index.ts`): Conversation turn recording no longer depends solely on the `chat.message` hook (which the SDK never fired). Direct capture added inside `tool.execute.after` (tool calls) and `composedMessagesTransform` (user/assistant messages) with per-session turn-index counters. Writes to `agent_conversation_turns`; visible in the Live Agent feed.
- **Hook method-name fixes** (`src/plugin/hooks/live-capture.ts`): `experimental.chat.messages.transform` → `chat.messages.transform`, `tool.execute.after` → `tool.after` to match the SDK's `callHooks` dispatch keys.
- **Skeletonize refactor** (`src/application/skeletonize.ts`): Stronger Wasm result typing; `getWasm` exported from `src/application/graph/build.ts` for reuse.
- Lint + build clean.

## v0.7.7
- Version bump only (no code changes).

## v0.7.6
- **Auto graph hints on search** (`src/plugin/hooks/graph-search-hint.ts`): After `grep`, `glob`, or `search` tools, calls `searchNodes` on the code graph and appends up to 3 matching symbol suggestions (function/class/interface) as a compact `[code-graph-search-hint]` block. Dedup guard: only fires if output doesn't already contain a graph context. Gated by `graph.enabled`.
- **Auto-skeletonize on large reads** (`src/plugin/hooks/graph-context.ts`): When reading a file with ≥ `autoSkeletonizeMinLines` lines (default 300), generates a skeleton via `extractSkeleton` and prepends it before the file content. Guards: skipped on offset reads, skipped when skeleton extraction returns empty/zero length. Config via `graph.autoSkeletonizeMinLines`.
- **Pressure-aware injection filtering** (`src/plugin/hooks/messages-transform.ts`): At aggressive pressure phase (≥ warn threshold), filters injection candidates to importance ≥ 0.6. At critical phase, filters to importance ≥ 0.8. Logs skipped count per phase.
- **Config**: New `graph.autoSkeletonizeMinLines` field (int, default 300) in both `MemConfig` interface and `GraphSchema` Zod schema.
- Lint + build clean.

## v0.7.5
- **Skeletonization → standalone tool**: Removed automatic skeletonization hook (`src/plugin/hooks/skeletonization.ts`). Replaced with explicit `skeletonize(path)` consolidated tool. Core logic kept at `src/application/skeletonize.ts`. Config field `fileSkeletonization` removed.
- **Graph preamble on read** (`src/plugin/hooks/graph-context.ts`): After every `read`, auto-injects code graph context (imports, symbols, dependents) as a comment-block preamble. Gated by `graph.enabled`.
- **Edit-time dependency warning** (`src/plugin/hooks/graph-edit-check.ts`): After `edit`/`write`, appends a warning listing dependents if the file is tracked in the code graph. Gated by `graph.enabled`.
- **Injection logging**: `logInjectionMetrics` wired into `auto-injection.ts` and `inject.ts`.
- **Grep compression fix**: small results (≤30 lines) pass through raw instead of being summarized.
- Lint + build clean.

## v0.7.4
- **Brain mesh 3D layout**: Replaced procedural sphere indicators with actual Desikan-Killiany atlas brain mesh. 70 DK parcels → 5 regions (prefrontal/frontal/parietal/temporal/occipital) merged into a ~101 KB GLB via `scripts/build-brain-glb.ts`. Standalone GLB 2.0 parser at `management/public/glb-loader.js`. Built at `management/public/models/brain-atlas.glb`.
- **Vertex-centroid node positioning**: Nodes positioned at vertex-averaged centroids of each brain region mesh (not bounding-box centers), ensuring accurate in-region placement.
- **Overlap resolution**: 5-pass push-apart per region (minDist=20) after centroid repositioning prevents node clustering.
- **Sprite-label sync**: Node sprites (descriptions) now track mesh positions with correct Y offset. Previously sprites were left at old positions due to `!obj.isMesh` filter skipping them.
- **Brain scale 2.5×**: Mesh and node positions scaled 2.5× for better visibility, camera radius reduced to 250.
- **Region click filtering**: Clicking a brain region mesh filters node list via `filterEngine.customTypes`.

## v0.7.3
- **System prompt merging**: Rule injection now merges into primary block (1 system message instead of 2+) — fixes compatibility with strict backends (Qwen/vLLM) that reject multiple system messages
- **Auto-seed**: All 6 `rule:feature:*` nodes (`command-compression`, `auto-retrieve`, `tag-intersection-search`, `source-propagation`, `confidence-diminishing-returns`, `graph-context`) now auto-seed on fresh databases via `src/seed-nodes.ts`
- **Brain layout mode**: New "Brain" layout in the 3D graph viewer — nodes arranged into 5 brain regions (Frontal/Parietal/Temporal/Prefrontal/Occipital) by supertype, with colored region indicators and labels
- **Sortable node list**: Node sidebar list now sortable by 9 fields (Level, Importance, Created, Updated, Label, Type, Usefulness, Access Count, Confidence) with direction toggle
- **Improved 3D visibility**: Reduced fog density 3×, increased node size + emissive for better visibility at zoom distance
- **Source propagation** — All node creation hooks now set `source` field: compaction middle-term (`auto_extract`), storedcontext archive (`auto_extract`), compression summaries (`llm_compress`), pattern extraction (`llm_compress`), seed initialization (`auto_extract`)
- **Confidence diminishing returns** — `verifyNode` now uses diminishing-returns curve: each verification adds `0.2 / (1 + verificationCount)` instead of flat +0.2
- **Tag intersection search** — `searchByEmbedding` accepts `tagsFilter` option for tag-based filtering (intersection semantics). 2 new tests
- **Management dashboard charts** — Supertype distribution bar chart, tag cloud (top 20, font-scaled), confidence histogram, stratum breakdown (hot/warm/cold)
- **Management filters** — Supertype and source dropdown filters, wired to client-side `NodeFilterEngine`
- **Tag editing in detail panel** — Inline tag add/remove with Enter key support
- **Source editing in detail panel** — Source field as dropdown with Save on change
- **Stats API extended** — `/api/stats` now returns `nodesPerSupertype`, `nodesPerSource`, `tagsFrequency`, `confidenceHistogram`, `stratumBreakdown`
- 129 tests pass, 0 lint errors, 0 typecheck errors
