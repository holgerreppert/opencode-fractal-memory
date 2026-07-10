# opencode-fractal-memory

Fractal memory system for [OpenCode](https://opencode.ai) with semantic search, automatic compression, and multi-level retrieval.

## Changelog

### v0.7.2
- **System prompt merging**: Rule injection now merges into primary block (1 system message instead of 2+) — fixes compatibility with strict backends (Qwen/vLLM) that reject multiple system messages
- **Auto-seed**: All 6 `rule:feature:*` nodes (`command-compression`, `file-skeletonization`, `auto-retrieve`, `tag-intersection-search`, `source-propagation`, `confidence-diminishing-returns`) now auto-seed on fresh databases via `src/seed-nodes.ts`
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

# about me and the usage

I made this because I needed a longterm memory at first.
Then while working with it I extended it's functionality.
I realized that the overall amout of tokens that gets used is huge.
So I tried to find ways to reduce that.
It might be a little bit overwhelming (lots of features)
but if you work with it you will start to love it.
It's kind of a swiss knife for opencode.
You can tell the coding agent to make a memory of everything.
And later on you can tell it to read it, making expensive queries
sometimes obsolete.

Tool output get's compressed.

There are also skill nodes.

You can also use the management app that includes a nice threejs visualization
and searching from there in the memory nodes.
You can also inject nodes directly to the agent from there.
You can edit the nodes too.

I think I forgot to mention some of the features here.

I'll update this project constantly.

Feel free to use it and tell me how much you hate or like it ;)

Have phun

Holger

PS.: Did I mention that this is alpha? So feel free to post issues with suggestions
if you find bugs or if you just want to suggest improvements 


## Features

- **Memory nodes** — structured persistent memory with labels, content, metadata, and type system
- **Semantic search** — ONNX-powered embeddings (all-MiniLM-L6-v2) with HNSW vector index for fast ANN retrieval
- **Native ONNX runtime** — `onnxruntime-node` with multi-threaded CPU execution (`intraOpNumThreads: 0`), full graph optimization (`graphOptimizationLevel: "all"`), CPU memory arena, and denormal/GELU approximation flags. 12-15× faster embedding inference vs WASM
- **BM25 hybrid search + dual retrieval** — keyword + vector hybrid scoring with dynamic weight adjustment; code queries get boosted BM25 weight for exact pattern matching. BM25 runs independently across ALL scope nodes (not just HNSW candidates), catching keyword matches outside the vector neighborhood and covering nodes without embeddings
- **Multi-hop temporal expansion** — temporally adjacent nodes (NEXT / DURING_SESSION edges) expanded up to 3 hops with 0.7^depth score decay, configurable via `temporal_hops` arg
- **Fractal retrieval** — drill-down from high-level summaries to granular details
- **Automatic compression** — periodically summarizes low-level nodes into progressively higher-level abstractions (4 levels + LLM-powered summaries)
- **Auto-retrieve (agent-pull model)** — reranks agent's `memory_search` results via Ollama LLM judge, in-process ONNX cross-encoder, or pure-JS fallback scoring (keyword overlap + metadata). No auto-injection — the agent pulls what it needs
- **Ollama / cross-encoder reranking** — dual-strategy reranking: LLM judge (via Ollama) or in-process ONNX cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`) for better relevance, plus a zero-dep fallback scorer when neither is available
- **Rerank intent system** — agents can signal what type of information to prioritize (facts, concepts, rules, etc.) via `pref:rerank-intent` preference node; scoring boosts matching node types
- **LLM compression** — uses LLM to generate richer summaries instead of regex extraction
- **Auto-distill** — automatically extracts actionable rules from lesson nodes into `### Auto-Learned` section
- **Predictive rating** — adjusts memory usefulness scores over time based on usage patterns
- **Cache system** — in-memory LRU cache for frequently accessed nodes with configurable TTL
- **Consolidation** — extracts semantic facts from episodic node clusters on session idle
- **Command compression** — zero-dependency compression of bash tool output (7 strategies: ls, test, grep, git-status, git-log, git-diff, git-quick, truncate + generic fallback). Optional Ollama extraction via small local model as last-resort. Stats tracked in `compression_stats` table. View via management app Compress tab
- **Context dashboard** — new management app tab showing memory node count/tokens by level, active rules, compression stats, recent injection history, and estimated total context usage with overhead breakdown
- **Structural shape detection** — automatically detects output shape (JSON, CSV, stack-trace, tree, table, compiler-diagnostics, test-output, npm-install, coverage-log) and applies tailored compressors (e.g., JSON → `Object(12 keys)`, stack-trace → error + unique frame count, compiler-diagnostics → errors grouped by file with codes). Falls through to generic if shape is unknown
- **SmartFilter** — noise-stripping preprocessor in shape detection: removes separator lines, progress bars, repeated punctuation, and leading/trailing blank lines before shape classification. Logged as `shape-json`, `shape-csv`, etc. with noise counts
- **Fuzzy dedup** — after exact SHA-256 dedup fails, computes trigram Jaccard similarity against recent outputs (threshold 0.85) to catch near-duplicates (timestamps, whitespace diffs). Logged as `fuzzy-dedup` in compress.log
- **Adaptive pressure** — tracks estimated context token usage; issues warnings and tightens `maxLines` (50→35→20→5) at configurable thresholds (70/85/95%). Logged to compress.log per phase transition
- **Output offloading** — when compressed output exceeds threshold (default 8K chars), writes to `~/.config/opencode/scratch/<hash>.out` and replaces with a short reference banner. Logged with offload_path and offload_bytes
- **Output token control** — injects `<system_reminder type="suggestion">` rules into the system prompt that constrain the agent's response length (sentence limit, char limit, bullet-only, or custom prompt). Mode: adaptive (tightens at context pressure thresholds), always-on, or off. 24 configurable fields. Logged to compress.log
- **Relevance trimming** — signal-word scoring: error terms (fail, error, fatal, exception) get +5 boost, keyword density weighted by position. Drops sub-threshold lines (default 0.15). Replaces legacy TF-IDF. Config via `commandCompression.relevanceTrimming*` fields. Opt-in (default false)
- **Relevant generic truncation** — relevance-weighted line selection instead of blind top-N truncation. Scores each line by signal-word density and keeps the highest-scoring lines up to maxLines when generic fallback fires. Falls back to blind truncation if relevance scoring fails
- **Delta compression** — when the same command runs again and output is ≥50% similar, emits only the diff lines (prefix/suffix) instead of the full compressed output. Config via `commandCompression.deltaCompression*` fields. Logged as `delta` in compress.log
- **Before/after compression statistics** — each compression event stores original_lines, compressed_lines, cmd_preview, and full content previews (up to 2K chars) in the DB. Management UI shows side-by-side before/after detail with expandable row modal
- **Code-aware output compression** — detects TS/JS/Python/Rust/Go/Java output and extracts imports + signatures + error lines with preserved line references instead of full file dumps
- **Session-persistent compression cache** — per-session JSON cache at `~/.config/opencode/scratch/session-<id>-cache.json` with 60-min TTL and 30s auto-save. Prevents redundant re-compression of identical command outputs within a session
- **Tool call deduplication** — LRU cache of tool call signatures per turn suppresses repeated identical calls (same tool + same args) before they waste LLM context. Config via `toolDedup` flag (default: on)
- **Error input pruning** — after 4 turns, replaces errored tool call input strings with `[<tool_name> call failed]` placeholder to reclaim context tokens without losing the failure signal. Config via `errorPruning` flag (default: off)
- **Structured memory injection** — injected memories formatted as XML-tagged `<memory_context label="..." type="..." importance="...">` blocks with structured metadata instead of raw text, improving LLM parsing of injected context
- **Stored context structured summaries** — `storedcontext` nodes (from compaction) now include a YAML header with `tools_used:`, `files_modified:`, `key_errors:`, `token_usage:`, and `turn_count:` fields for efficient cross-session scanning
- **Cross-session context injection** — on new sessions, searches `storedcontext` nodes via `searchText` and injects structured summaries of prior sessions as `<system_reminder type="info">` blocks. 60s throttle between fetches
- **Adaptive rule selection** — scores each rule against the current user message via keyword-overlap similarity. Mandatory rules always inject; standard/suggestion/info need ≥0.15 relevance threshold. Logged with injected/total counts
- **Progressive rule disclosure** — at context pressure thresholds, strips non-essential rules: >75% removes suggestion/info, >85% removes standard, >95% requires ≥0.50 relevance for any non-mandatory rule. Reads global `__pressureState` from output-token-control
- **Proactive compaction nudge** — when context pressure hits warn(75%)/aggressive(85%)/critical(95%), injects a context-pressure warning into the system prompt urging the agent to use `memory_recall_context`, `memory_middle_term`, or `memory_search` to reduce token usage
- **File skeletonization** — inline AST skeleton extraction for large file reads (>200 lines). Extracts imports, function/class signatures with line numbers via tree-sitter WASM (32 languages) + regex fallback. 40-95% reduction on file reads
- **Re-read elimination** — when a file is read multiple times and hasn't changed on disk, serves the cached content with `[File unchanged since turn N]` banner, eliminating redundant reads entirely. Logged to filesum.log (RE-READ component)
- **Code knowledge graph** — builds a directed graph of code symbols (functions, classes, interfaces, types) and their relationships (calls, imports, references, defined_in, extends) via tree-sitter WASM AST extraction. 32 supported languages. Louvain community detection clusters related code; god-node and surprising-connections analysis highlight architectural hotspots
- **Pull-based code graph** — graph builds automatically on plugin init and auto-refreshes on `edit`/`write` (configurable via `graph.refreshEnabled`). No banner injection on reads, no system rule spamming. Agents call the `graph` tool on demand with `relation=callers|callees|call_chain|imports|dependents|search|explain|path`. Incremental rebuild on `session.idle` catches external changes.
- **Graph usage tracking** — every graph action (build, search, path, explain, graph tool call, background build) is counted in-memory and logged to `graph-usage.log` with source identifier (`mcp`, `management`, `plugin-hook`, `buildGraph`, etc.) and session ID for audit
- **Dedicated log files** — separate `filesum.log` for skeletonization events and `compress.log` for command compression events, auto-rotating
- **Session logging** — opt-in session log with 1MB rotation for observability
- **Journal** — append-only searchable journal entries with semantic search
- **Playbooks** — reusable workflow templates (sticky memory nodes) proposed by the agent
- **Management server** — local web UI (port 8787) for browsing, searching, editing, backup/restore, and 3D visualization with temporal edge rendering. Settings panel organized into 5 collapsible categories, resizable sidebar with persisted width
- **Multi-graph retrieval** — temporal edges (NEXT, DURING_SESSION, CAUSAL, REFERENCES, RELATED_TO) expanded during search with confidence-weighted hop decay
- **Auto-edge creation** — `memory_set` auto-creates NEXT edges (session chaining) and REFERENCES edges (from `label:xxx` patterns) during active sessions
- **Synthetic evaluation** — 79-node/175-QA benchmark dataset for reproducible retrieval quality metrics (HitRate, Recall, Precision, MRR)
- **Sub-agents** — `memory-hints`, `memory-researcher`, and `translate` agents for guided interaction

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **OpenCode** | v1.15.13+ | SDK peer dependency |
| **Bun** | >=1.0.0 | Plugin runtime |
| **Node.js** | >=18 | For npm-based installs only |

## Installation

### For OpenCode users

Add the plugin name to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-fractal-memory"]
}
```

OpenCode installs it automatically at startup from npm. Model files (~24 MB) download on first plugin load via `ensureModels()` — no manual steps needed.

### Updating

OpenCode caches plugins at `~/.cache/opencode/packages/`. When a new version is published to npm, the cache may stay pinned to the old version due to bun's dual caching (lockfile + global metadata cache):

```bash
# Clear bun's global metadata cache and force re-resolve
rm -rf ~/.bun/install/cache/
cd ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
bun add opencode-fractal-memory@latest
```

If that doesn't work, copy the published files manually:

```bash
cd <your-local-clone>
npm run build
cp -r dist management package.json LICENSE README.md commands agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

This is a known OpenCode issue: [#6774](https://github.com/anomalyco/opencode/issues/6774), [#10546](https://github.com/anomalyco/opencode/issues/10546), [#25293](https://github.com/anomalyco/opencode/issues/25293).

### For development / manual install

```bash
npm install opencode-fractal-memory
```

Models download on first run. Use `--ignore-scripts` if installing via Bun (Bun skips lifecycle scripts).

### MCP server setup

Enables memory tools in IDEs that support the Model Context Protocol (Cursor, Windsurf, etc.):

```json
{
  "mcp": {
    "fractal-memory": {
      "type": "local",
      "command": ["bun", "run", "~/.config/opencode/node_modules/opencode-fractal-memory/dist/mcp-server.js"],
      "enabled": true
    }
  }
}
```

## Configuration

Create `~/.config/opencode/opencode-mem.json` to customize (optional — all defaults work out of the box). This is the **single** config file — all settings including journal and management live here:

```json
{
  "autoRetrieve": {
    "enabled": true,
    "candidateCount": 30,
    "maxInjectNodes": 5,
    "maxInjectPlaybooks": 3,
    "minQueryLength": 10,
    "injectionCooldownMs": 30000,
    "llmJudgeEnabled": true
  },
  "ollama": {
    "enabled": false,
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5-coder:1.5b",
    "mode": "binary",
    "strategy": "llm"
  },
  "llmCompression": {
    "enabled": false,
    "maxSummaryTokens": 500
  },
  "autoDistill": {
    "enabled": false,
    "minLessons": 3,
    "useLlm": false
  },
  "autoConsolidate": {
    "enabled": false,
    "similarityThreshold": 0.3,
    "maxFactsPerCluster": 5,
    "minClusterSize": 2
  },
  "predictiveRating": {
    "enabled": false,
    "decayDays": 30,
    "confidenceThreshold": 0.3,
    "positiveBoost": 0.1,
    "negativePenalty": 0.05
  },
  "management": {
    "enabled": true,
    "port": 8787
  },
  "journal": {
    "enabled": false
  },
  "maxInjectionTokens": 8000,
  "coreInjectionTokens": 2000,
  "cacheSize": 8,
  "cacheTTLHours": 2,
  "autoCompressThreshold": 0.7,
  "highContextThreshold": 0.6,
  "criticalContextThreshold": 0.8,
  "defaultTtlDays": 0,
  "enableMiddleTermCapture": true,
  "fileSkeletonization": {
    "enabled": true,
    "minLines": 200,
    "strategy": "ast+regex"
  },
  "graph": {
    "enabled": true,
    "maxFiles": 5000
  },
  "commandCompression": {
    "enabled": true,
    "maxLines": 50,
    "excludeCommands": ["curl", "wget"],
    "alwaysFullOnFailure": true
  },
  "sessionLog": {
    "enabled": false
  }
}
```

### Config reference

| Field | Type | Default | Description |
|---|---|---|---|---|
| `autoRetrieve.enabled` | bool | `false` | Enable automatic memory injection into prompts |
| `autoRetrieve.candidateCount` | int | `30` | Number of candidates to fetch for injection |
| `autoRetrieve.maxInjectNodes` | int | `5` | Max memory nodes to inject per turn |
| `autoRetrieve.maxInjectPlaybooks` | int | `3` | Max matching playbooks to list |
| `autoRetrieve.minQueryLength` | int | `10` | Min user message length to trigger injection |
| `autoRetrieve.injectionCooldownMs` | int | `30000` | Min ms between injections (rate limit) |
| `autoRetrieve.llmJudgeEnabled` | bool | `true` | Use SDK `session.prompt({noReply:true})` for relevance scoring when Ollama is off |
| `ollama.enabled` | bool | `false` | Use local LLM for reranking search results |
| `ollama.baseUrl` | string | `http://localhost:11434` | Ollama server URL |
| `ollama.model` | string | `qwen2.5-coder:1.5b` | Model for reranking |
| `ollama.mode` | enum | `"binary"` | `"binary"` (relevant/not) or `"score"` (0-1 rating) |
| `ollama.strategy` | enum | `"llm"` | `"llm"` (LLM judge via Ollama) or `"cross-encoder"` (in-process ONNX cross-encoder) |
| `llmCompression.enabled` | bool | `false` | Use LLM for richer compression summaries |
| `llmCompression.model` | string | _none_ | LLM model name (uses ollama if not set) |
| `llmCompression.maxSummaryTokens` | int | `500` | Max tokens per LLM-generated summary |
| `autoDistill.enabled` | bool | `false` | Auto-extract rules from lesson nodes |
| `autoDistill.minLessons` | int | `3` | Min lessons before extraction |
| `autoDistill.useLlm` | bool | `false` | Use LLM for more specific rules |
| `autoDiscover.enabled` | bool | `false` | Auto-detect playbook patterns from tool call sequences |
| `autoDiscover.minSequenceLength` | int | `3` | Min steps for a detected pattern |
| `autoDiscover.minRepeatCount` | int | `2` | Min repeats to qualify as a pattern |
| `autoDiscover.maxInjectPlaybooks` | int | `3` | Max proposed playbooks per detection |
| `autoConsolidate.enabled` | bool | `false` | Extract semantic facts from episodic session clusters on idle |
| `autoConsolidate.similarityThreshold` | float | `0.3` | Cosine similarity threshold for clustering episodic nodes |
| `autoConsolidate.maxFactsPerCluster` | int | `5` | Max facts to extract per cluster |
| `autoConsolidate.minClusterSize` | int | `2` | Min episodic nodes needed to form a cluster |
| `predictiveRating.enabled` | bool | `false` | Auto-decay and boost node usefulness |
| `predictiveRating.decayDays` | int | `30` | Days until usefulness decay (exponential half-life) |
| `predictiveRating.confidenceThreshold` | float | `0.3` | Min confidence to count as relevant |
| `predictiveRating.positiveBoost` | float | `0.1` | Usefulness boost on positive rate |
| `predictiveRating.negativePenalty` | float | `0.05` | Usefulness penalty on negative rate |
| `maxInjectionTokens` | int | `8000` | Max tokens allowed in a single injection |
| `coreInjectionTokens` | int | `2000` | Tokens reserved for core rules in injection |
| `cacheSize` | int | `8` | Max cached nodes in LRU cache |
| `cacheTTLHours` | int | `2` | Cache entry TTL in hours |
| `autoCompressThreshold` | float | `0.7` | Context usage ratio triggering auto-compression |
| `highContextThreshold` | float | `0.6` | Token usage ratio for high context warning |
| `criticalContextThreshold` | float | `0.8` | Token usage ratio for critical warning |
| `defaultTtlDays` | int | `0` | Default TTL for new nodes (0 = no expiry) |
| `enableMiddleTermCapture` | bool | `true` | Save middle-term snapshots before compression |
| `management.enabled` | bool | `false` | Auto-start the management web UI on plugin init |
| `management.port` | int | `8787` | Port for the management server |
| `journal.enabled` | bool | `false` | Enable append-only searchable journal entries |
| `fileSkeletonization.enabled` | bool | `true` | Inline AST skeleton for large file reads |
| `fileSkeletonization.minLines` | int | `200` | Min file lines to trigger skeletonization |
| `fileSkeletonization.strategy` | enum | `"ast+regex"` | `"ast+regex"` (tree-sitter + regex fallback) or `"regex"` only |
| `graph.enabled` | bool | `true` | Enable code knowledge graph (AST extraction + `graph` tool + auto-refresh) |
| `graph.maxFiles` | int | `5000` | Max files to extract in background build |
| `graph.refreshEnabled` | bool | `true` | Auto-re-extract on edit/write |
| `commandCompression.enabled` | bool | `true` | Compress bash tool output |
| `commandCompression.maxLines` | int | `50` | Max lines for generic truncation |
| `commandCompression.excludeCommands` | string[] | `["curl","wget"]` | Commands to never compress |
| `commandCompression.alwaysFullOnFailure` | bool | `true` | Preserve full output on non-zero exit |
| `sessionLog.enabled` | bool | `false` | Log session events to separate file |
| `toolDedup` | bool | `true` | Deduplicate repeated identical tool calls within a turn |
| `errorPruning` | bool | `false` | Replace errored tool call inputs with placeholders after 4 turns |
| `commandCompression.relevanceTrimmingEnabled` | bool | `false` | Signal-word relevance trimming of command output |
| `commandCompression.relevanceTrimmingThreshold` | float | `0.15` | Min TF-IDF score to keep a line |
| `commandCompression.relevanceTrimmingMinKeep` | int | `5` | Min lines to keep regardless |
| `commandCompression.relevanceTrimmingAlwaysKeepTop` | int | `3` | Always keep top N lines |
| `commandCompression.deltaCompressionEnabled` | bool | `true` | Delta/differential compression for repeated commands |
| `commandCompression.deltaMaxCacheSize` | int | `50` | Max cached outputs per command |
| `commandCompression.deltaMinSimilarity` | float | `0.5` | Min Jaccard similarity to attempt delta |
| `outputTokenControl.enabled` | bool | `false` | Inject concise-output rules into system prompt |
| `outputTokenControl.mode` | enum | `"adaptive"` | `"adaptive"`, `"always-on"`, or `"off"` |
| `outputTokenControl.strategy` | enum | `"concise"` | `"concise"`, `"sentence_limit"`, `"char_limit"`, `"bullet_only"`, `"custom"` |
| `outputTokenControl.maxSentences` | int | `5` | Sentence limit (base/always-on) |
| `outputTokenControl.maxChars` | int | `0` | Global char limit (0 = disabled) |
| `outputTokenControl.customPrompt` | string | `""` | Custom rule text for `custom` strategy |
| `outputTokenControl.warnThreshold` | float | `0.7` | Context % for warn level |
| `outputTokenControl.aggressiveThreshold` | float | `0.85` | Context % for aggressive level |
| `outputTokenControl.criticalThreshold` | float | `0.95` | Context % for critical level |
| `outputTokenControl.normalSentences` | int | `5` | Sentence limit at normal pressure |
| `outputTokenControl.warnSentences` | int | `3` | Sentence limit at warn pressure |
| `outputTokenControl.aggressiveSentences` | int | `1` | Sentence limit at aggressive pressure |
| `outputTokenControl.criticalSentences` | int | `1` | Sentence limit at critical pressure |
| `outputTokenControl.normalStrategy` | enum | `"concise"` | Strategy at normal pressure |
| `outputTokenControl.warnStrategy` | enum | `"sentence_limit"` | Strategy at warn pressure |
| `outputTokenControl.aggressiveStrategy` | enum | `"sentence_limit"` | Strategy at aggressive pressure |
| `outputTokenControl.criticalStrategy` | enum | `"char_limit"` | Strategy at critical pressure |
| `outputTokenControl.normalPrompt` | string | `""` | Custom prompt at normal (for custom strategy) |
| `outputTokenControl.warnPrompt` | string | `""` | Custom prompt at warn |
| `outputTokenControl.aggressivePrompt` | string | `""` | Custom prompt at aggressive |
| `outputTokenControl.criticalPrompt` | string | `""` | Custom prompt at critical |
| `outputTokenControl.excludePatterns` | string[] | `[]` | Regex patterns to skip constraint injection |

## Advanced Features

### Reranking (LLM / Cross-Encoder)

Auto-retrieve results can be re-ranked for better relevance using one of two strategies, configurable via the `ollama.strategy` field or the management app:

```json
{
  "ollama": {
    "enabled": true,
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5-coder:1.5b",
    "mode": "binary",
    "strategy": "llm"
  }
}
```

**LLM judge** (`strategy: "llm"`, default) — scores candidates via Ollama chat API. In `"binary"` mode the LLM labels each as relevant or not; in `"score"` mode it assigns a 0-1 relevance rating.

**Cross-encoder** (`strategy: "cross-encoder"`) — runs an in-process ONNX cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`, ~23 MB) for deterministic relevance scoring without needing Ollama. The model auto-downloads on first use via `ensureModels()`. This bypasses Ollama's missing `/api/rerank` endpoint entirely.

**SDK LLM judge** — when Ollama is disabled and `autoRetrieve.llmJudgeEnabled` is true (default), the plugin calls `client.session.prompt({noReply:true})` to have the session's LLM score memory relevance directly. Falls back to heuristic scoring if no session client is available. Configurable via `autoRetrieve.llmJudgeEnabled` in the management app Settings → Memory & Storage.

### Rerank Intent

Agents can tell the memory system what kind of information to prioritize by setting a preference node:

```
memory_set(
  label: "pref:rerank-intent",
  content: "boost: fact=1.5, rule=0.5, concept=1.2",
  type: "pref"
)
```

The `boost:` line lists node types with priority multipliers. Types not listed get neutral weight (1.0). Setting weight 0 suppresses a type entirely. The auto-retrieve hook reads this node before scoring and applies the multiplier to each candidate's hybrid score. The reranker then re-ranks the already-boosted candidates — effectively guiding the reranker toward the types the agent needs.

Works with any memory type: `fact`, `concept`, `lesson`, `howto`, `decision`, `architecture`, `bug`, `fix`, and more. The rule is reset when a new `pref:rerank-intent` node is set.

### LLM Compression

Instead of regex-based compression (which extracts keywords), LLM compression generates richer natural-language summaries:

```json
{
  "llmCompression": {
    "enabled": true,
    "model": "qwen2.5-coder:1.5b",
    "maxSummaryTokens": 500
  }
}
```

Invoke manually with `memory_llm_compress`.

### Auto-Distill

Periodically extracts actionable rules from `lesson`-type nodes created by `memory_reflect`. Rules are stored as `rule:standard:*` / `rule:suggestion:*` nodes for immediate injection:

```json
{
  "autoDistill": {
    "enabled": true,
    "minLessons": 3,
    "useLlm": false
  }
}
```

Set `useLlm: true` for LLM-generated rules instead of keyword extraction.

### Episodic / Semantic Memory Categories

Every memory node is auto-categorized on creation based on its type. This affects retrieval, decay, and consolidation:

| Category | Types | Half-life | Search weight |
|---|---|---|---|
| **Episodic** | event, note, session, task, plan, exploration, debug-investigation, improvement, review | 7 days | 0.5× importance |
| **Semantic** | concept, fact, lesson, rule:*, decision, architecture, howto, preference, convention, skill, playbook, knowledge, research, core, summary, bug, fix, etc. | 365 days | 1.0× importance |

- **Episodic** nodes decay fast and are weighted lower in search — they represent session-level traces.
- **Semantic** nodes persist long-term and are boosted in search — they represent learned knowledge.
- Use `category_filter` on `memory_search` to scope searches (e.g. `memory_search(category_filter="semantic")`).
- Dashboard shows the category distribution.

### Consolidation

When a session goes idle, `autoConsolidate` extracts semantic facts from episodic clusters and promotes them to `type: "fact"` nodes. This creates a bridge from ephemeral session traces to long-term knowledge:

```json
{
  "autoConsolidate": {
    "enabled": true,
    "similarityThreshold": 0.3,
    "maxFactsPerCluster": 5,
    "minClusterSize": 2
  }
}
```

How it works:
1. Collects all episodic nodes created during the session
2. Clusters them by cosine similarity of their embeddings
3. Extracts declarative statements (uses "is"/"has"/"uses"/"defines" patterns)
4. Creates new `type: "fact"` semantic nodes with `parentIds` pointing back to source episodic nodes
5. Facts persist with full semantic weight and long decay half-life (365 days)

### Predictive Rating

Automatically adjusts node usefulness scores over time. Frequently accessed nodes get boosted; nodes that haven't been touched in `decayDays` get gradually decayed:

```json
{
  "predictiveRating": {
    "enabled": true,
    "decayDays": 30,
    "confidenceThreshold": 0.3,
    "positiveBoost": 0.1,
    "negativePenalty": 0.05
  }
}
```

### Command Compression

Built-in, zero-dependency compression for bash tool output. 7 strategies automatically detect the command type:

| Strategy | Matches | Output |
|---|---|---|
| `ls` | `ls`, `tree` | Tree with dir/file counts |
| `test` | `npm test`, `bun test`, `pytest`, etc. | Pass/fail summary + failure details |
| `grep` | `grep`, `rg` | Grouped by file with match counts |
| `git-status` | `git status` | Branch + staged/unstaged counts |
| `git-log` | `git log` | One-line per commit |
| `git-diff` | `git diff` | N files changed, +M -L |
| `git-quick` | `git push/pull/commit/add` | First 3 lines only |
| `truncate` | `cat`, `head`, `build`, `docker`, `find`, `tail` | Dedup + maxLines (default 50) |
| `generic` | (fallback) | Dedup + truncate at maxLines |

Stats tracked in the `compression_stats` table. View at management app → **Compress** tab. Full output preserved on non-zero exit (tee mode).

**Relevance trimming** — when enabled, TF-IDF scores each line against command terms and drops lines below the threshold. Keeps at least `minKeep` lines and always preserves the top `alwaysKeepTop` lines. Config under `commandCompression.relevanceTrimming*`.

**Delta compression** — when the same command runs multiple times and the new output is ≥50% similar (Jaccard) to the cached previous output, only the differing lines are emitted as a delta. The delta shows `- prefix lines` + new content + `+ suffix lines`. Config under `commandCompression.deltaCompression*`.

```json
{
  "commandCompression": {
    "enabled": true,
    "maxLines": 50,
    "excludeCommands": ["curl", "wget"],
    "alwaysFullOnFailure": true
  }
}
```

Configure via `~/.config/opencode/opencode-mem.json` or the management app Settings → AI & Compression.

### File Skeletonization

When reading large source files (>200 lines), the plugin can inline a skeleton: imports, function/class/interface/trait/enum signatures with line numbers, and nested members. This replaces verbose full-file content with just the structure.

Uses **tree-sitter WASM** (`@kreuzberg/tree-sitter-language-pack-wasm`, 32 languages) for deterministic AST extraction — no AI, no external binary. Falls back to regex for unsupported languages.

Offset/limit reads always pass through untouched. Skeleton is only applied when it reduces file size by at least 50%.

```json
{
  "fileSkeletonization": {
    "enabled": true,
    "minLines": 200,
    "strategy": "ast+regex"
  }
}
```

Configure via `~/.config/opencode/opencode-mem.json` or the management app Settings → Memory & Storage.

## Commands

### Memory tools

| Command | Description |
|---|---|
| `memory_set` | Create or update a memory node |
| `memory_get` | Get a single node by ID or label |
| `memory_fetch` | Fetch a node by exact label |
| `memory_search` | Search nodes by text, embedding, or BM25 — supports `category_filter`, `expand_links`, `expand_temporal` |
| `memory_delete` | Delete a node by ID or label |
| `memory_list` | List nodes with optional scope/level filters |
| `memory_replace` | Replace content in a memory node |
| `memory_rate` | Rate a node's usefulness (helps ranking) |
| `memory_prune` | Find and remove stale/unused nodes |
| `memory_temporal_edges` | Inspect temporal edges between nodes (conversation flow) |
| `memory_inject` | Inject relevant memories into the prompt with token budgeting |
| `memory_injection_debug` | Show what was injected in the last session |
| `memory_injection_feedback` | Rate injected memory usefulness |
| `memory_injection_stats` | View injection efficiency metrics |
| `memory_drilldown` | Retrieve a node with its source chain (fractal retrieval) |
| `memory_drilldown_query` | Top-down drilldown by query (find + expand) |
| `memory_detect_topics` | Detect topic clusters in memory |
| `memory_stats` | Show memory statistics (nodes per level, compression ratios) |
| `memory_dashboard` | Display memory dashboard with visual overview |
| `memory_tool_stats` | View tool call statistics and efficiency |
| `memory_session_stats` | Get statistics about the current session |
| `memory_compress` | Compress old nodes into higher-level summaries |
| `memory_llm_compress` | LLM-powered compression (richer summaries) |
| `memory_extract_patterns` | Extract cross-topic pattern summaries |
| `memory_distill` | Extract actionable rules from lesson nodes |
| `memory_summarize` | Generate an LLM prompt to summarize a node |
| `memory_check_context` | Check token usage of memory nodes |
| `memory_total_tokens` | Complete token analysis (memory + conversation) |
| `memory_generate_embeddings` | Generate embeddings for nodes that lack them |
| `memory_middle_term` | View context snapshots before compaction |
| `memory_cache_status` | Show working-memory cache usage |
| `memory_skill_load` | Load a skill's instructions by name |
| `memory_playbook_execute` | Execute a playbook workflow |
| `memory_verify` | Verify that a node's information is correct |
| `memory_reflect` | Analyze a session and create lesson nodes |
| `memory_help` | Show all available memory commands |
| `memory_version` | Show installed plugin version |

### Playbook tools

| Command | Description |
|---|---|
| `memory_playbook_execute` | Execute a playbook (returns steps for the agent to run) |

Playbooks are stored as `type: "playbook"` memory nodes with steps in `metadata`. CRUD uses generic `memory_set` / `memory_get` / `memory_search` tools. The agent proposes playbooks when it spots repeated multi-step patterns.

### Journal tools

| Command | Description |
|---|---|
| `journal_write` | Write a new journal entry |
| `journal_read` | Read a journal entry by ID |
| `journal_search` | Search journal entries semantically |

### MCP tools

When the MCP server is configured, the memory and graph tools are available as MCP resources for IDE integration.

| Tool | Description |
|---|---|
| `graph(relation, name?, file?, depth?, query?, from?, to?, id?, limit?)` | Unified code graph navigator. Relations: `callers`/`callees`/`call_chain`/`imports`/`dependents`/`search`/`explain`/`path`. Returns JSON with `{relation, results, truncated}` |

## Skills

Skills are specialized instruction sets stored as memory nodes. When a task matches a skill's trigger keywords, its instructions load into context to guide the agent.

### Available skills

| Skill | Triggers |
|---|---|
| `debug-workflow` | bug, error, fix, crash |
| `write-tests` | tests, coverage, test suites |
| `refactor-component` | refactor, restructure, clean up |
| `refactoring-expert` | SOLID, code smell, technical debt |
| `code-reviewer` | review, PR, pull request, code quality, audit |
| `ai-code-pitfalls` | AI generated, hallucinated, copilot, cursor, LLM output |
| `security-review` | security, audit, vulnerability, deploy |
| `threejs-skills` | 3D, WebGL, visualization |
| `svelte-core-bestpractices` | svelte, component, runes |
| `svelte-code-writer` | svelte 5, sveltekit, component |
| `customize-opencode` | opencode config, agent, plugin |
| `context-engineering` | context, prompt, system message |
| `git-workflow-and-versioning` | git, commit, branch, version, publish |
| `incremental-implementation` | step by step, increment, gradual |
| `opencode-plugin-installation` | installation, update, upgrade, cache, stale, version, publish |

### Loading a skill

```ts
memory_skill_load(name="debug-workflow")
```

Skills are auto-injected when triggers match the task context. You can also load them explicitly with `memory_skill_load`.

### Creating a skill

Skills are memory nodes with `type: "skill"`. Create one with:

```ts
memory_set(
  label: "skill:my-skill",
  content: "## Skill instructions...",
  type: "skill",
  metadata: JSON.stringify({ triggers: ["keyword1", "keyword2"] }),
  sticky: true
)
```

## Sub-agents

The plugin ships with two agent instruction files for specialized memory interaction:

| Agent | File | Purpose |
|---|---|---|
| `memory-hints` | `agent/memory-hints.md` | System-level hints for using memory effectively — injected by the agent when memory-related context is needed |
| `memory-researcher` | `agent/memory-researcher.md` | Analyzes and reports on fractal memory state — invoked via `memory_skill_load(name="memory-researcher")` |

These are loaded by OpenCode's agent system and provide structured guidance for memory operations.

## Management App

A local web UI for browsing, searching, and editing memory — available when the plugin is active.

### Starting

The server starts automatically when `management.enabled: true` is set in `~/.config/opencode/opencode-mem.json` (see [Configuration](#configuration)), or manually:

```bash
bun run view
```

Opens at [http://localhost:8787](http://localhost:8787). The server starts as a background process and auto-stops on plugin shutdown.

### Usage

**3D Graph** — the default view shows memory nodes as spheres connected by `[[wiki-link]]` relationships and temporal edges:
- **Drag** to rotate the scene
- **Scroll** to zoom in/out
- **Left-click** a node to select and inspect it
- **Right-click drag** to pan
- Nodes are color-coded by level and type (skill = gold icosahedron, playbook = orange torus, note = blue sphere)
- Playbook nodes render as orange torus shapes with steps visible in the detail panel
- **Temporal edges** render as colored lines: NEXT (green), DURING_SESSION (blue dashed), CAUSAL (red), REFERENCES (yellow dotted), RELATED_TO (magenta) — see the Legend panel for color mapping
- Click a node to see its temporal connections in the detail panel with direction, edge type, and confidence score

**Filters** — narrow down visible nodes:
- **Scope** (global/project)
- **Level** (L0–L5), **Type** (note, skill, playbook, etc.), **Shape**, **Custom Type**
- **Project** — when multiple projects exist, filter by project name
- **Clear All Filters** button resets everything at once
- **Search** — find nodes by content, label, or type:
  - Type a query and press Enter
  - Results show relevance scores and preview snippets
  - Click a result to navigate to it in the graph

**Inspect** — when you click a node (graph or search results):
- View full content and summary
- See metadata JSON (type, importance, access count, timestamps)
- View embedding vector (truncated)
- See linked nodes and navigate between them

**Edit** — modify node fields directly:
- Update content, summary, importance, or type
- Changes persist immediately to the SQLite database
- Embedding auto-regenerates on content change

**Inject** — push a node directly into the agent's context:
- Click "Inject" on any node
- The node appears in the agent's next prompt
- Useful for reminding the agent of past decisions mid-session

**Manage** — the node list view shows all nodes with:
- Scope (global vs project), level, access count
- Last accessed and last verified timestamps
- Actions: edit, delete, verify, inject

**Backup** — the Backup tab lets you create and restore snapshots of your memory data:
- Select sources to back up (config, global DB, project DB) via checkboxes
- Backups stored at `~/.config/opencode/backups/` as flat directories with a `manifest.json`
- DB snapshots use `sqlite3_serialize()` for consistent WAL-safe copies
- Restore with per-source selection — a pre-restore safety backup is auto-created
- Manual retention: list, inspect, and delete backups from the UI

**Context** — shows a unified dashboard of all memory node tokens by level/type, active rules, compression savings, recent injection history, and estimated total LLM context usage (memory + system prompts + tool defs + conversation estimate).

**Compress (Before/After)** — the compression tab now shows each event with before/after char counts, line counts, and duration. Click any row to see a modal with the full before/after content preview side-by-side.

## How Plugin Initialization Works

When OpenCode loads the plugin, `initStorage()` runs automatically:

1. **SQLite database** — created at `~/.config/opencode/memory.db` with all tables and indexes. Project-scope nodes are stored alongside global nodes with a `project_name` discriminator column
2. **Seed nodes** — rule nodes, built-in playbooks (6), and skills (15) inserted into `memory_nodes`
3. **Model files** — `ensureModels()` checks `~/.config/opencode/models/` and downloads ONNX + tokenizer (~24 MB) if missing
4. **Agent files** — `ensureAgentFiles()` copies `agent/` directory to `~/.config/opencode/agent/`
5. **Command files** — `ensureCommandFiles()` copies `commands/` directory to `~/.config/opencode/commands/`
6. **Background embeddings** — after 1s, generates embeddings for nodes that lack them
7. **Auto-retrieve hook** — if enabled in config, injects relevant context into prompts

Every initialization step is logged with timing in `logs/memory-plugin.log`, making it easy to diagnose startup issues.

All of this happens automatically — no manual intervention required.

## Hook Timeline — Plugin x OpenCode SDK

The plugin hooks into the OpenCode agent via the Plugin SDK. Here's the exact per-turn lifecycle, from system prompt assembly through tool execution:

### Per-Turn Cycle (each agent reasoning turn)

```
┌─ PHASE 1: SYSTEM PROMPT ───────────────────────────────────────────┐
│  experimental.chat.system.transform                                  │
│                                                                     │
│  seed-rules        Loads rule:mandatory/*, rule:standard,            │
│                    rule:suggestion, rule:feature/* from DB →                  │
│                    injects as <system_reminder> tags.                          │
│                    Adaptive selection scores rules against user message;       │
│                    progressive disclosure at >75%/>85%/>95% pressure           │
│                                                                               │
│  output-token-     If context pressure is high, injects a                     │
│  control           concise-output rule into the system prompt.                 │
│                    At pressure thresholds, also injects compaction nudge       │
│                                                                     │
│  graph-refresh     Auto-re-extract graph on edit/write               │
│                    available" with node/edge counts                  │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ PHASE 2: MESSAGES (before LLM) ───────────────────────────────────┐
│  experimental.chat.messages.transform                                │
│                                                                     │
│  messages-         Calls drilldownQuery(userText) for raw memory     │
│  transform         injection into the message list — uses            │
│                    structured <memory_context> XML format             │
│                                                                     │
│  auto-retrieve     Finds memory_search tool results in pending       │
│                    messages → re-ranks candidates via Ollama /       │
│                    LLM judge / fallback scorer → rewrites order      │
│                                                                     │
│  tool-dedup        LRU cache deduplicates repeated tool calls        │
│                    (same tool + same args in current turn)           │
│                                                                     │
│  error-prune       After 4 turns, replaces errored tool input        │
│                    strings with [<tool> call failed] placeholder     │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ PHASE 3: CHAT PARAMS (before LLM) ────────────────────────────────┐
│  chat.params                                                        │
│                                                                     │
│  adaptive-         If pressure phase is warn/aggressive/critical:    │
│  pressure           → clamps temperature (0.5 → 0.1)                 │
│                     → clamps maxOutputTokens (4096 → 1024)           │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
╔══════════════════════════════════════════════════════════════════╗
║  PHASE 4: LLM CALL                                               ║
║  ─ Agent reasoning happens here ─                                 ║
║  ─ LLM decides which tools to call ─                              ║
╚══════════════════════════════════════════════════════════════════╝
        │
        ▼  (for EACH tool the LLM calls)
┌─ PHASE 5: TOOL BEFORE ───────────────────────────────────────────┐
│  tool.execute.before                                               │
│                                                                   │
│  read tool:                                                       │
│    re-read-elimination  If file cached + mtime unchanged →        │
│                         serves cached content, **skips** read      │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ PHASE 6: TOOL EXECUTES ───────────────────────────────────────────┐
│  (OpenCode runs the actual tool)                                    │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ PHASE 7: TOOL AFTER ────────────────────────────────────────────┐
│  tool.execute.after                                                │
│                                                                   │
│  bash tool:                                                       │
│    adaptive-           Records output size → prepends pressure     │
│    pressure            warning if nearing context limit            │
│    compression         Compresses output via delta / fuzzy-dedup / │
│                        7 strategies (ls/test/grep/git-*),          │
│                        code-aware shape detection (source-code /   │
│                        compiler-diagnostics / test-output /        │
│                        npm-install / coverage-log),                │
│                        session-persistent cache → may offload      │
│                        >8KB to scratch dir                         │
│                                                                   │
│  read tool:                                                       │
│    skeletonization    If >200 lines → tree-sitter AST skeleton    │
│                       or regex fallback replaces full content      │
│    re-read-           Caches result + mtime for future re-read    │
│    elimination        elimination checks                          │
│    graph-refresh      Auto-re-extract on edit/write               │
│                                                                   │
│  edit/write tool:                                                 │
│    graph-refresh      Re-extracts changed file into the graph     │
│                       (single-file incremental update, ~1-5ms)    │
│                                                                   │
│  memory_* tools:                                                  │
│    recording          Logs memory tool calls to store +            │
│                       predictive rating                            │
│    working-cache      Feeds memory results into in-memory          │
│                       working cache (used during compaction)      │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ PHASE 8: LOOP ───────────────────────────────────────────────────┐
│  If there are pending tool results to send back to the LLM →       │
│  go back to Phase 2 (messages.transform fires again with the       │
│  new tool results added to the message list)                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Compaction (triggered by OpenCode when context is full)

| Hook | Handler | What it does |
|---|---|---|
| `experimental.session.compacting` | compaction | Captures working cache → middle-term context node. Archives full conversation history → storedcontext node (with embedding for semantic recall). Records per-turn token usage stats |
| `experimental.compaction.autocontinue` | compaction | Forces `output.enabled = true` so the agent auto-resumes after compaction |
| `event('session.idle')` | events | Auto-distill (LLM extracts rules from lessons) + auto-consolidation + score decay + incremental graph rebuild |
| `event('session.compacted')` | events | Cleanup middle-term captures + score decay + auto-consolidation |
| `event('session.deleted')` | events | Stops management server if no active sessions remain |

### Key Design Principles

| Principle | Detail |
|---|---|
| **Everything runs before the LLM response** | All hooks fire before the LLM generates text — the plugin modifies inputs (system prompt, messages, params) and tool results, never the LLM's response |
| **Tool execution can be skipped** | Only `tool.execute.before` handlers (re-read-elimination, graph-tools) can short-circuit execution by pre-filling the output |
| **Post-processing feeds the next turn** | `tool.execute.after` modifies tool results that will be sent back to the LLM on the *next* iteration of Phase 2 |
| **Graceful degradation** | Every handler is wrapped in a try/catch in `hooks.ts` — a single handler failure never crashes the agent |
| **No auto-injection for memory** | By default, memory retrieval is agent-driven (`memory_search`/`memory_get`). The `messages.transform` hook is an opt-in alternative |

### Source Map

| Hook point | Orchestrator | Individual handlers |
|---|---|---|
| `experimental.chat.system.transform` | `src/plugin/hooks.ts:61` | `seed-rules.ts`, `output-token-control.ts` |
| `experimental.chat.messages.transform` | `src/plugin/hooks.ts:75` + `src/plugin/index.ts:58` | `messages-transform.ts`, `auto-retrieve/index.ts`, `tool-dedup.ts`, `error-prune.ts` |
| `chat.params` | `src/plugin/hooks.ts:73` | `chat-params.ts` |
| `tool.execute.before` | `src/plugin/hooks.ts:63` | `re-read-elimination.ts` |
| `tool.execute.after` | `src/plugin/hooks.ts:65` | `compression.ts`, `adaptive-pressure.ts`, `skeletonization.ts`, `re-read-elimination.ts`, `recording.ts`, `working-cache.ts` |
| `experimental.session.compacting` | `src/plugin/hooks.ts:67` | `compaction.ts` |
| `event` | `src/plugin/hooks.ts:77` | `events.ts` |

## Logs

All plugin logs are consolidated under `~/.config/opencode/logs/`:

| Log | Path | Contents |
|-----|------|----------|
| Plugin | `logs/memory-plugin.log` | Plugin operations, init steps with timing, auto-retrieve, session events |
| MCP server | `logs/mcp-server.log` | MCP tool calls, resources, errors |
| Injection debug | `logs/memory-injection.log` | Full auto-retrieve injection payloads (rotated at 1 MB) |
| Context dump | `logs/context-dump.log` | Full context snapshots for debugging |
| Skeletonization | `logs/filesum.log` | Skeletonization apply/skip/error (auto-rotated at 2 MB) |
| Command compression | `logs/compress.log` | Compression events per command: strategy, original/compressed sizes, reduction pct, duration (auto-rotated at 2 MB) |
| Graph usage | `logs/graph-usage.log` | Graph tool calls with source, action type, and session ID (auto-rotated at 2 MB) |
| Session log | `logs/sessionlog.log` | Session lifecycle events (enabled via `sessionLog.enabled`) |
| OpenCode | `~/.local/share/opencode/log/` | Application lifecycle, tool calls |

## Development

```bash
git clone <repo>
cd opencode-fractal-memory
bun install
bun run build
bun run typecheck
```

### Testing

```bash
bun test
```

### Installing locally (development)

```bash
bun run build
npm pack
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts <path-to-tgz>
```

Use `--ignore-scripts` to avoid trust prompts. Models download automatically on first plugin load via `ensureModels()` in `initStorage()`.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Plugin Layer (plugin/index.ts)                           │
│  ┌──────────┬──────────┬──────────┬───────────┬──────┐  │
│  │ Memory    │ Skills   │ Journal  │ Auto-     │ Code │  │
│  │ Store     │ (nodes)  │ Store    │ Retrieve  │Graph │  │
│  └────┬─────┴────┬─────┴────┬─────┴─────┬─────┴──────┘  │
│       │          │          │           │               │
│  ┌────┴──────────┴──────────┴───────────┴───────────┐  │
│  │ SQLite (~/.config/opencode/memory.db)             │  │
│  │  - memory_nodes (labels, content, embeds)         │  │
│  │    - scope: "global" | "project"                  │  │
│  │    - project_name (for project-scope nodes)       │  │
│  │    - type: "note" / "skill" / "playbook"         │  │
│  │    - sticky playbooks/skills never pruned         │  │
│  │    - metadata.steps for playbook steps            │  │
│  │  - memory_links (wiki-link crossrefs)             │  │
│  │  - bm25_index (full-text search)                 │  │
│  │  - injection_metrics / session_metrics            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ HNSW Vector Index (in-memory, 384-dim)            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
  │  │ ONNX Embedding Model (all-MiniLM-L6-v2)           │  │
  │  │ onnxruntime-node + @huggingface/tokenizers        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Code Graph (in-memory graphology)                  │  │
│  │  - Node types: file, function, class, interface    │  │
│  │  - Edge types: calls, imports, references, extends │  │
│  │  - Louvain community detection                     │  │
│  │  - Incremental rebuild via file SHA-256 hashing    │  │
│  │  - Thread-safe: plugin hooks + MCP + management    │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Storage

Unified SQLite database with `project_name` discriminator:

| Path | Purpose |
|---|---|
| `~/.config/opencode/memory.db` | Global rules, persona, preferences (scope=global) + project-specific memory, nodes, playbooks (scope=project, discriminated by `project_name`) |

## License

MIT

## Changelog

### v0.6.49 (2026-07-10)
- **Hierarchical Type System (supertypes)** — All nodes auto-derived to a supertype (declarative/procedural/experiential/meta) from their type. Migration v29 adds `supertype` column. Search scoring uses supertype for smarter intent-aware weighting.
- **Intent-Aware Retrieval Biasing** — `searchByEmbedding` accepts `intent` option (`read`/`edit`/`debug`/`discovery`). Each intent biases retrieval weights differently: read/edit boost procedural+declarative (1.3×), debug boosts experiential (1.3×), discovery uses uniform weights.
- **Temporal Stratification** — Search results now stratified by recency: hot (<1d, 1.0×), warm (<7d, 0.85×), cold (≥7d, 0.5×). Each node gets a stratum weight applied in scoring.
- **Tag System** — `memory_set` accepts `tags` parameter (string array). Stored as JSON in new `tags` column. Displayed in management UI detail panel. Searchable via SQL.
- **Confidence Tracking** — `verification_count` column tracks how many times a node has been verified. `memory_verify` increments both confidence (by +0.2) and verification count (by +1). Management UI shows verification count and Verify button.
- **Provenance Tracking** — `source` column records how a node was created (manual/tool_result/auto_extract/web_search/reflection/llm_compress). Displayed in management UI.
- **Management UI updates** — Detail panel now shows supertype, tags (as chips), source, verification count. POST `/api/nodes/:id/verify` endpoint added with Verify button.
- **Migration v29** — `ALTER TABLE memory_nodes ADD COLUMN supertype TEXT` with index.
- **Migration v30** — Batch: `tags TEXT`, `source TEXT`, `verification_count INTEGER DEFAULT 0`.

### v0.6.48
- **Ollama output extraction** — when heuristic compression strategies don't match, fires a small Ollama model (default `qwen3.5:3b`) to extract only the relevant lines from tool output. Zero-shot extraction with ~0.55 recall at 50-90% compression. Configurable via `commandCompression.ollamaExtraction` in `opencode-mem.json`. Last-resort fallback, enabled by default with `enabled: false` (opt-in)
- New file: `src/application/command-compression/ollama-extract.ts`
- Added `OllamaExtractionConfig` to CompressConfig, MemConfig, Zod schema with defaults

### v0.6.47
- **Tool output compression** — read/glob/edit tool output compression (structural summarization, grouping, trimming), improved git-quick strategies (push/commit/add/pull), word abbreviations (45 long→short forms), grouped grep output by extension, context-aware relevance trimming with intent terms from command args, reversible compression with stash to scratch + `cat <path>` marker
- See `src/application/tool-compression.ts`, `src/application/command-compression/strategies/git.ts` and `src/application/command-compression/utils.ts` for details

### v0.6.46
- **Dual retrieval** — BM25 now runs independently across ALL scope nodes (not just HNSW candidates). Top BM25-only candidates (keyword matches outside the vector neighborhood) are fetched and merged with HNSW results. Catches nodes without embeddings that match via keywords. Changes in `src/storage/search.ts:181-228`. 60 tests pass (22 search, 38 search-helpers)
- **Usefulness scoring fix** — `memory_inject` boosts `usefulnessScore` + `timesHelpful` for each injected node; `memory_search` boosts `usefulnessScore` for each retrieved node; recording hook rates follow-up tools (edit/bash/write) on success, no longer skipping `memory_*` tool results
- **Storedcontext default scores lowered** — defaults reduced from `usefulnessScore: 0.5` + `importance: 3.0` to `0.1` + `0.5`, matching normal note baselines so search-driven scoring determines actual usefulness
- **Backfill script** — new `scripts/backfill-embeddings.ts` backfilled 382 missing embeddings across all nodes, reset 615 stuck-at-0.0 nodes to 0.1 baseline
- **Search pipeline graphviz** — `docs/search-pipeline.gv` updated with dual retrieval flow (all_nodes → bm25_score → bm25_only → merge → final)

### v0.6.43
- **Fix: run management server in-process when bun not in PATH** — Instead of giving up or spawning with the wrong binary, `startInProcess()` dynamically creates the Router, registers routes, and calls `Bun.serve()` directly in the plugin process. Both subprocess (bun in PATH) and in-process (embedded bun) paths are supported. Falls through to in-process if subprocess spawn throws

### v0.6.42
- **Fix: management server uses `Bun.which("bun")` instead of `process.execPath`** — `process.execPath` in OpenCode's embedded bun returns the OpenCode binary path (not bare bun). Spawning `opencode script.js` doesn't run the script. Changed to `Bun.which("bun")` — if bun is in PATH, spawn with it
- **Fix: management server spawn on bun-less systems** — `src/management-server.ts` was hardcoding `["bun", standalonePath]` in `Bun.spawn()`. On fresh machines where bun is embedded in OpenCode's runtime but not in `$PATH`, this failed with `"Executable not found in $PATH: \"bun\""`. Changed to `process.execPath` which resolves to the current bun binary regardless of PATH

### v0.6.40
- **ONNX runtime fallback** — new `src/infrastructure/llm/onnx-runtime.ts` adapter tries `onnxruntime-node` first, falls back to `onnxruntime-web` (WASM) when native bindings aren't available. Covers Alpine Linux, older glibc, and unsupported architectures. `onnxruntime-web` added to `package.json` dependencies. `getRuntimeInfo()` exported for management UI
- **Graceful degradation** — `embeddings.ts` and `cross-encoder.ts` now call `ensureOnnxRuntime()` before first use instead of importing the onnxruntime package directly. If both runtimes fail, a descriptive error is thrown
- **Management UI runtime indicator** — `GET /api/embeddings-status` now reports the actual runtime name (`"node"` or `"web"`) instead of a hardcoded string
- **Plugin hook timeline docs** — comprehensive per-turn lifecycle documentation in README.md covering all 8 phases (system.transform → messages.transform → chat.params → LLM → tool.before → tool.execute → tool.after → loop), compaction flow, design principles table, and source map linking each SDK hook point to its orchestrator and handlers

### v0.6.39
- **Native ONNX runtime** — switched from `onnxruntime-web` (WASM, single-threaded) to `onnxruntime-node` (native, multi-threaded). Session config: `executionProviders: ["cpu"]`, `graphOptimizationLevel: "all"`, `intraOpNumThreads: 0`, `enableCpuMemArena: true`, `extra: { session: { set_denormal_as_zero: "1" }, optimization: { enable_gelu_approximation: "1" } }`. Benchmarked 5 docs in 27ms (embed) and 3 pairs in 334ms (cross-encoder) after warmup
- **`generateEmbeddings()` bulk path** — new exported function in `embeddings.ts` supporting batch embedding of multiple texts using a shared session instance; uses parallel execution for small batches (≤4) and sequential for larger sets
- **Management app Embedding Engine status** — new `GET /api/embeddings-status` endpoint and context dashboard card showing runtime, backend, optimization level, threading, and model info
- **AGENTS.md update** — quick iteration script now copies `onnxruntime-node` (with native binary) to cache `node_modules/`

### v0.6.38
- **Code knowledge graph** — new `src/application/graph/` module with `CodeGraph` class (graphology), tree-sitter WASM AST extraction via `process()` API (32 languages), Louvain community detection, god-node analysis, surprising-connections detection, shortest-path query. Edges: `calls`, `imports`, `defined_in`, `references`, `extends` with `EXTRACTED | INFERRED | AMBIGUOUS` confidence
- **Always-on graph hooks** — `plugin/hooks/graph-tools.ts`: `ensureBackgroundGraph()` on plugin init and `tool.before` for read/grep/glob; graph stats rule injected via `system.transform` hook. Config via `graph.enabled`, `graph.maxFiles`, `graph.ruleEnabled`
- **MCP graph tools** — `graph_build`, `graph_search`, `graph_path`, `graph_explain`, `graph_usage`. Each process (plugin, MCP, management server) builds its own graph independently — no inter-process dependency on the management server
- **Management API + UI** — `POST /api/graph/build`, `GET /api/graph`, `GET /api/graph/search`, `POST /api/graph/path`, `POST /api/graph/explain`, `GET /api/graph/usage`, `GET /api/graph/export`. D3.js force-directed graph visualization tab with community colors, degree-sized nodes, tooltip, search highlight, focus animation
- **Incremental builds** — file SHA-256 hashing tracks changes; subsequent builds only re-extract modified files. Community detection runs once (lazy). Background build uses config maxFiles (default 5000)
- **Graph usage tracking** — every `track*()` call logs to `graph-usage.log` with source identifier (`mcp`, `management`, `plugin-hook`, `buildGraph`, etc.) and session ID. View via `graph_usage` MCP tool or `GET /api/graph/usage`

### v0.6.37
- **LLM judge scoring** — new `llmJudgeScore()` in auto-retrieve pipeline: calls `client.session.prompt({noReply:true})` to score memory candidates when Ollama is off. Falls back to heuristic `fallbackScore()` on error or when no session is available. Configurable via `autoRetrieve.llmJudgeEnabled` (default `true`). Tracks current session ID via `chat.message` hook.
- **`memory_llm_compress` session ID fix** — `generateLLMSummary` was hardcoding session ID as `'compression'` (which doesn't exist), causing `session.prompt()` to silently fail and fall back to regex every time. Fixed by threading the real `toolCtx.sessionID` through `runCompression` → `generateLLMSummary`. Interface updated: `IMaintenanceStore.runCompression`, `SqliteMemoryStore.runCompression`, `runCompressionFn`, `generateLLMSummary` all accept optional `sessionId` param.

### v0.6.36
- **`chat.params` SDK hook** — adaptive pressure-based temperature/maxTokens clamping in the `chat.params` pipeline. Gated by `adaptivePressure.enabled`. Logged to compress.log when clamping is applied.
- **`messages.transform` SDK hook** — alternative memory injection path via `experimental.chat.messages.transform`. Performs a drilldown query against top auto-retrieve candidates, injecting relevant context as additional messages. Falls through on empty results.
- **`compaction.autocontinue` pipeline wiring** — `experimental.compaction.autocontinue` now calls through the handler chain (was a bare `{ enabled: true }`) so compaction hook logic integrates with the autocontinue flow.
- **Config merge fix (`writeProjectConfig`)** — `writeProjectConfig` now deep-merges with existing config instead of overwriting it. Prevents silent data loss when management app saves partial config updates. Uses recursive `deepMerge()` for nested objects.
- **Filter engine refactor** — `hideAll` flag (`matches()` returns `false` when no filters are active), consistent `matches()` semantics (empty filter sets are now pass-through, not reject-all), `toggleAll(category)` per-category toggle method, `selectAll()` bulk-select. Fixes invisible-scene-on-load bug.
- **3D graph layout improvements**:
  - Grid-accelerated repulsion force (3×3×3 cell neighborhood reduces O(n²) to O(kn) for nearby pairs)
  - Sim bounds debug logging removed
  - Connectivity-aware initial placement (`_nudgeConnectedNodes`) pulls connected components toward centroids pre-simulation
  - Post-simulation overlap prevention pass (3 iterations, pushes overlapping nodes apart)
  - Center pull reduced (0.008 vs 0.02) and cooling-modulated for gentler shell convergence
  - Spring rest length now based on node sizes (sprite radius) instead of fixed per-level
  - Velocity damping increased (0.82 vs 0.85), maxStep reduced
  - Simulation iterations increased (300 vs 150)
- **Select All / Clear All buttons** — new `#select-all-filters` button alongside `#clear-filters` in the visualize panel. Select All resets filters and activates all available categories. Clear All now sets `hideAll=true` (hides all nodes) consistent with clearing all selections.
- **Per-category "All" toggle** — `toggleAll(category)` on the `NodeFilterEngine` class, wired to existing `data-select-all` buttons. Clicking "All" for a category adds all values; clicking again removes them all.

### v0.6.35
- **SmartFilter** — noise-stripping preprocessor for shape detection: removes separator lines, progress bars, repeated punctuation, and leading/trailing blank lines. Logged with noise counts per shape event
- **Signal-word relevance scoring** — replaces legacy TF-IDF with error-term boosted (+5 for fail/error/fatal/exception) and keyword-density-weighted per-line scoring for relevance trimming
- **Relevant generic truncation** — relevance-weighted line selection replaces blind top-N in generic fallback. Scores lines by signal-word density, keeps highest-scoring up to maxLines

### v0.6.34
- **Relevance trimming** — TF-IDF scores each output line against command query terms; drops sub-threshold lines (threshold 0.15, minKeep 5, alwaysKeepTop 3). Config via `commandCompression.relevanceTrimming*` fields. Opt-in (default false). Logged to compress.log.
- **Delta compression** — per-command output cache (max 50). When new output is ≥50% similar (Jaccard) to cached output, emits a diff (prefix/suffix) instead of re-compressing. Config via `commandCompression.deltaCompression*` fields. Enabled by default.
- **Context dashboard** — new management app tab (`/api/context-dashboard`) showing memory tokens by level/type, active rules, compression savings, recent injection history, and estimated total context. Summary cards, by-level/by-type tables, injection history table.
- **Before/after compression stats** — migration v26 adds `original_lines`, `compressed_lines`, `cmd_preview`, `original_preview`, `compressed_preview` to `compression_stats` table. Compress tab now shows rich per-event table (before K, after K, Δlines, savings, duration). Click-to-expand modal with side-by-side raw vs compressed content preview. Strategy breakdown with raw/compressed/saved columns. `contentSnippet()` in log output for all compression events.
- **Output token control** — injects concise-output `<system_reminder type="suggestion">` rules into the system prompt. Three modes: adaptive (tightens at 70/85/95% context), always-on, or off. Five strategies: concise, sentence_limit, char_limit, bullet_only, custom. Per-level overrides for sentences, strategy, and custom prompt. Exclusion patterns (regex). 24 config fields with Zod schema + management UI. Logged to compress.log as `output-token-control`.
- **386 tests, 0 fail** (20 new tests — 16 unit + 4 integration).

### v0.6.32 (2026-06-19)
- **Cross-encoder reranker** — in-process ONNX cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`) replaces the unavailable Ollama `/api/rerank` endpoint. Configurable via `ollama.strategy: "cross-encoder"` (vs `"llm"` default). Management app UI dropdown to switch strategies. Model auto-downloads with `ensureModels()`.
- **Rerank intent system** — agents set `pref:rerank-intent` preference node with `boost: type=weight` directives. `resolveRerankIntent()` in auto-retrieve hook reads the node and applies type multipliers to scoring before the reranker runs. Instructions added to `rule:mandatory:tools` seed node so agents know the pattern.
- **Bug fixes:**
  - **HNSW `removeNode`** — `globalDeletedIds`/`projectDeletedIds` Sets filter deleted IDs from search results; previously was a no-op (only removed label-map entry). Rebuild clears deleted sets.
  - **MemoryRate** — removed `updates.timesHelpful = 1` pre-set that caused double-counting (set to 1 then immediately incremented to 2).
  - **MemoryReplace off-by-one** — `<=` → `<` in loop bound caused spurious match when content length equaled old text length.
  - **MemorySet parent_ids** — now splits by comma/trims `args.parent_ids` instead of wrapping single string in array, fixing multi-parent input.
  - **Sync I/O** — `fs.statSync`/`fs.readFileSync` replaced with `await fs.promises.stat`/`await fs.promises.readFile` in async hooks.
  - **Score normalization** — min-max normalization of semantic scores before convex combination with BM25 in `computeFinalScores`, preventing BM25 from dominating on non-uniform score distributions.
- **Memory leak fixes** — SESSION_LAST_NODE capped at 500 entries; workingMemoryCache prunes stale sessions at 100+; idScopeCache clears at 5000+ entries.
- **Skills injection redesign** — replaced proactive XML block injection with `<!-- Relevant skills: ... -->` HTML comment; agent now calls `memory_skill_load()` reactively when needed.
- **Graphviz diagram** — `docs/agent-communication-pipeline.{dot,svg,png}` documenting plugin ↔ agent communication channels.
- **366 tests, 0 fail** (unchanged).

### v0.6.31 (2026-06-18)
- **Temporal edges in management UI** — new `GET /api/temporal-edges` endpoint with optional `?node_id=` and `?project_name=` filters. Three.js 3D viewer renders 5 edge types with distinct colors and styles (NEXT=green solid, DURING_SESSION=blue dashed, CAUSAL=red solid, REFERENCES=yellow dotted, RELATED_TO=magenta solid). Spring forces applied during simulation pull temporally connected nodes closer. Detail panel shows per-node temporal connections with direction, type badge, and confidence score. Legend updated with temporal edge color swatches.
- **366 tests, 0 fail** (was 363).

### v0.6.30 (2026-06-16)
- **Working cache population** — `addToWorkingCache`/`clearWorkingCache` added to `src/cache.ts`; previously the working cache was declared but never written to (always returned `[]`).
- **Memory tool tracking** — `tool.execute.after` handler now populates the working cache from `memory_fetch`, `memory_get`, `memory_drilldown`, `memory_set`, `memory_replace`, and `memory_search` results. Each cache population logs the full content via `memLog("debug", "working-cache", ...)`.
- **Middle-term capture now includes full content** — capture nodes store the complete `content` per working cache entry (previously truncated at 500 chars). Full capture JSON logged via `memLog("info", "compaction", ...)`.
- **Store fallback** — `experimental.session.compacting` handler falls back to the 8 most recently created nodes from the database when the in-memory working cache is empty, ensuring middle-term captures always have data. Fallback content logged via `memLog("debug", "compaction", ...)`.
- **339 tests, 0 fail** (unchanged).

### v0.6.29 (2026-06-16)
- **Compaction hooks integration** — three new handler registrations:
  - `experimental.session.compacting`: captures middle-term context (working cache snapshot) as a sticky metadata node before compaction runs. Gated by `enableMiddleTermCapture` config (default: true).
  - `session.compacted` event: runs cleanup for old middle-term captures, score decay, and consolidation after compaction completes.
  - `experimental.compaction.autocontinue`: defaults to `enabled: true` (pass-through).
- **6 new tests** for `cleanupMiddleTermCaptures` in `src/plugin/hooks.test.ts`.
- **339 tests, 0 fail** (was 333).

### v0.6.28 (2026-06-16)
- **HNSW combined-search bug fix** — when searching both global and project scopes simultaneously, overlapping internal HNSW integer IDs caused project results to be mapped through the global label map. Fixes `searchByEmbedding` returning wrong/missing nodes when both scopes are populated.
- **searchByEmbedding sort fix** — `computeFinalScores` doesn't sort, and SQL `WHERE id IN (...)` returns rows in arbitrary order, so top HNSW results could fall outside the `slice(0, limit)` window. Added sort by importance before slicing.
- **333 tests, 0 fail** — 58 new tests added:
  - `search-helpers.test.ts` (34 tests) — `calculateDynamicBm25Weight`, `detectCodeQuery`, `computeRecencyScore`, `computeBM25TermScore`, `computeBM25Scores`, `computeBM25ScoresSQL`, `updateBM25Index`/`removeBM25Index`, `computeFinalScores`, `rerankResults`
  - `search.test.ts` (20 tests) — `searchByEmbedding` with HNSW, level/category/usefulness filters, fallback cosine path, expired exclusion, multi-scope; temporal expansion with 1-2 hops, DURING_SESSION edges; BM25 integration with rerank

### v0.6.27 (2026-06-16)
- **Session logging** — opt-in session log via `sessionLog.enabled` config field. Writes to `~/.config/opencode/logs/sessionlog.log` with 1MB rotation. Log calls in session lifecycle hooks and auto-retrieve. Toggle in management app settings panel.
- **Management server caching fix** — `Cache-Control: no-cache` headers on all served files so browser always fetches latest management app HTML/JS.
- **Orphaned management server fix** — PID file at `~/.config/opencode/management-server.pid`, kill orphaned servers on restart, `GET /api/shutdown` endpoint.
- **Model-router: toolStreaming fix** — `toolStreaming: false` added to mittwald provider-level options in `opencode.json`; model-router config hook now forwards model-level options into subagent agent definitions.
- **Hybrid retrieval ported to core** — default `bm25Weight` changed from 0 to 0.4 in `searchByEmbedding`. Multi-hop temporal expansion (`temporalHops` option, up to 3 hops, 0.7^depth score decay) ported from benchmark to `src/storage/search.ts`. `temporal_hops` arg added to `memory_search` tool and MCP server.
- **Published to npm** as `opencode-fractal-memory@0.6.27`.

### v0.6.25 (2026-06-15)
- **Bug fix: 10 unawaited async calls in sqlite.ts** — `queryDeleteNode` inside `withRetryableTransaction`, session-tracking calls, and injection-event calls now properly awaited.
- **Bug fix: HNSW ghost entries** — `.filter(r => r.id !== "")` strips ghost results from deleted nodes.
- **Bug fix: pruneNodes HNSW cleanup** — `pruneNodes` now calls `hnsw.removeNode()` for each pruned node.
- **Benchmark improvement** — hybrid BM25+vector search at 0.5× weight, multi-hop temporal expansion up to 3 hops, score decay 0.7^depth. Overall F1: 14.33% → 16.10%.
- **Model-router configured** — "local" preset with budget mode: @fast=gemma4:latest, @medium=gemma4:latest, @heavy=deepseek-v4-flash-free.
- **Translate subagent** — read-only agent for natural language translation (mittwald/gpt-oss-120b).
- **12 maintenance tests** added in `src/storage/maintenance.test.ts`.
- **Published to npm** as `opencode-fractal-memory@0.6.25`.

### v0.6.24 (2026-06-15)
- **Episodic / Semantic memory categories** — all nodes auto-categorized on creation. Episodic types (event, session, task, etc.) decay with 7-day half-life and 0.5× search weight. Semantic types (concept, fact, lesson, rule, etc.) decay with 365-day half-life and 1.0× search weight. Dashboard shows category distribution; search/drilldown show `[episodic]`/`[semantic]` tags; `category_filter` arg on `memory_search`.
- **Consolidation bridge** — `autoConsolidate` extracts semantic facts from episodic clusters on `session.idle` and stores them as persistent `type: "fact"` nodes with `parentIds` back to source nodes. New `"fact"` node type added.
- **Auto-retrieve relevance filters** — `maxLevel: 0` blocks L1+ compression summaries from injection; `categoryFilter: "semantic"` blocks episodic session traces. Config gains `minQueryLength` and `injectionCooldownMs`.
- **Auto-retrieve dedup + rate limit** — session-level injection cache (prevents re-injecting same node IDs), query similarity skip (cosine > 0.95 skips re-injection), 30s cooldown, short message bypass (`minQueryLength=10`), skills cache with 5-minute TTL.
- **Migration v23** — adds `category` column to `memory_nodes` with index.
- **`memory_temporal_edges` tool** — inspect temporal edges (conversation flow) between nodes.
- **`category_filter` arg** added to `memory_search` and `category_filter` option to `memory_drilldown`.
- **Cross-project auto-retrieve pollution fix** — added `(scope === "global" || projectName === currentProject)` post-search filter in auto-retrieve hook. Prevents nodes from other projects being injected into the current session.
- **`memory_list scope=project` auto-scopes to current project** — `memory_list scope=project` now defaults `project_name` to the current project, avoiding confusing cross-project node listings. To see all projects, pass `project_name=""` explicitly.
- **Management UI project dropdown** — replaced button-based project filter with a `<select>` dropdown for cleaner project selection.
- **Management API `?project_name=` support** — `/api/nodes`, `/api/links`, `/api/stats` accept optional `project_name` query param for server-side filtering.
- **Bug fix: 10 unawaited async calls in sqlite.ts** — `queryDeleteNode` inside `withRetryableTransaction`, session-tracking calls (`insertAgentToolCall`, `createSessionMetricsRow`, `updateSessionMetrics`, `incrementSessionToolCall`), and injection-event calls (`insertInjectionMetrics`, `updateMemoryToolCall`, `finalizeInjection`, `insertInjectionFeedback`, `insertToolUsageLog`) now properly awaited. Critical: `queryDeleteNode` inside a transaction callback could commit before the DELETE completed.
- **Bug fix: HNSW search returning ghost entries** — `HNSW.removeNode` only removed the label-map entry (the HNSW library doesn't support point deletion), causing `search()` to return `{ id: "", score }` for deleted nodes. Added `.filter(r => r.id !== "")` to strip ghost results.
- **Bug fix: pruneNodes not cleaning up HNSW index** — `pruneNodes` deleted nodes from the database but didn't call `hnsw.removeNode()`, leaving ghost points in the HNSW graph. Added cleanup loop for each pruned node.

### v0.6.23 (2026-06-08)
- **Backup/Restore** — new Backup tab in the management UI. Create timestamped snapshots of config, global DB, and project DB. Restore with per-source selection; pre-restore safety backup auto-created. Backups stored as flat directories at `~/.config/opencode/backups/` — zero external deps.
- **`projectName` cross-project filtering** — Added `project_name` arg to all CLI tools, MCP tools, and storage layer
- **Bug fix: global scope always skipped** — Removed `?? store.projectName` default that caused `projectName` to always be set, preventing global memory from being searched. Now `project_name` is only passed when explicitly provided; when omitted, searches both global and project scopes
- **Config unification** — `management.enabled/port` and `journal.*` moved from separate `agent-memory.json` into the main `opencode-mem.json` config file. Single config source of truth
- **Arg description updates** — All tool arg descriptions and command files updated to reflect the new behavior

### v0.6.21 (2026-06-07)
- **Command file audit** — consistent `name=value` named arg format across all command files
- `memory-rate.md` — added frontmatter so it registers as a valid command
- `memory-set.md` — replaced fictional Supabase example with generic JWT example
- `memory-list.md`, `memory-compress.md`, `memory-prune.md` — added proper Usage/Arguments sections
- `agent/memory-hints.md` — all examples converted to named arg syntax, types fixed

### v0.6.20 (2026-06-07)
- README update — cache staleness workaround, plugin version endpoint docs

### v0.6.19 (2026-06-07)
- **Metadata support** — `memory_set` and MCP `memory_set` now accept `metadata` JSON string arg
- `MemoryGet` now displays metadata section when present
- `skill:opencode-plugin-installation` created with auto-detection triggers
- Docs: `memory-set.md`, `memory-get.md`, `memory-help.md`, `agent/memory-hints.md` updated

### v0.6.18 (2026-06-07)
- README cache staleness workaround added

### v0.6.17 (2026-06-07)
- **Duplicate file node fix** — replaced `listNodes("project")` with `getNodeByLabel()` in hooks.ts
- File nodes now update on re-read instead of being skipped
- DB cleanup: removed 552 duplicate file nodes (reduced 1375→825 nodes)

### v0.6.16 (2026-06-07)
- Plugin version displayed in management app sidebar
- `GET /api/version` endpoint added

### v0.6.15 (2026-06-06)
- **Project switcher** — filter memory nodes by project name in management UI
- **Clear all filters** — one-click reset of all active filters
- **Playbook nodes** — now render as orange torus with step details in management UI
- **TYPE_COLORS** — playbooks (orange) and skills (gold) have dedicated colors in 3D scene
- Backend: `project_name` in API responses, `GET /api/projects` endpoint

### v0.6.14 (2026-06-06)
- Session reference counter fix — management server only stops when all sessions end

### v0.6.13 (2026-06-06)
- Event hook refactor — management server lifecycle tied to real `session.created`/`session.deleted` events

### v0.6.12 (2026-06-06)
- Fixed management server lifecycle — SIGKILL instead of SIGTERM, proper event hooks
