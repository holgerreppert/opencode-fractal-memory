# opencode-fractal-memory

Plugin providing infinite context memory for OpenCode via SQLite, embeddings, and BM25 hybrid search.

## Architecture

- **Storage**: SQLite (`~/.config/opencode/memory.db`), sqlite-vec (cosine sim), FTS5 (BM25)
- **Hooks**: `tool.execute.before` (file summarization), `tool.execute.after` (memory + compression), `experimental.chat.system.transform` (rule injection), `experimental.chat.messages.transform` (auto-retrieve reranking + memory injection), `chat.message` (session ID tracking), `event` (lifecycle)
- **Management app**: Served on `http://localhost:8787`, spawned as subprocess. HTML at `management/public/`, API routes at `src/management/routes.ts`
- **Config**: `~/.config/opencode/opencode-mem.json`, validated with Zod schema (src/config.ts)
- **Logging**: Dedicated per-feature log files at `~/.config/opencode/logs/` — `memory-plugin.log`, `filesum.log`, `compress.log`, `sessionlog.log` (see `src/logging.ts`)

## Command Output Compression (`commandCompression`)

Built-in, zero-dependency compression in `tool.execute.after` for bash commands. Strategies:

- `ls` → tree summary (dir/file counts)
- Test runners (npm test, bun test, pytest, etc.) → pass/fail summary + failures
- `grep`/`rg` → group by file with match counts
- `git status` → branch + staged/unstaged counts
- `git log` → one-line per commit
- `git diff` → N files changed, +M -L
- `git-quick` (push/pull/commit/add) → first 3 lines only
- `truncate` (cat, head, build, docker, find, tail) → dedup + truncate at maxLines
- Generic fallback → dedup + truncate at maxLines (default 50)
- Full output preserved on non-zero exit ("tee mode")

Stats recorded to `compression_stats` table. View at management app → Compress tab.

All compression events (including shape detection, fuzzy dedup, offloading, and adaptive pressure) log to `~/.config/opencode/logs/compress.log` via `writeCompressLog()`.

### Structural Shape Detection

Before falling through to generic truncation, the output is classified by its structural shape:

| Shape | Strategy | Compressor |
|---|---|---|
| JSON | `shape-json` | `Object(N keys)` / `Array(N)` summary |
| CSV/TSV | `shape-csv` | Row/column count + header + first 3 rows |
| Stack trace | `shape-stack` | Error lines + unique frame count + first 15 frames |
| Tree | `shape-tree` | Depth + dir/file counts |
| Table | `shape-table` | Row count + first 5 rows |

Only applied when the shaped output is ≥20% smaller than the raw output. Falls through to generic otherwise. Logged as `shape-json`, `shape-csv`, etc.

### Fuzzy Dedup (`commandCompression.fuzzyDedup*`)

After exact SHA-256 dedup fails, computes trigram Jaccard similarity against the most recent N cached outputs (default 50). If similarity ≥ threshold (default 0.85), serves `§fuzzy:<hash>§` ref instead of the near-duplicate output. Config:

```json
{
  "commandCompression": {
    "fuzzyDedupEnabled": true,
    "fuzzyDedupThreshold": 0.85,
    "fuzzyDedupMax": 50
  }
}
```

Logged as `fuzzy-dedup` with similarity percentage.

### Adaptive Pressure (`adaptivePressure`)

Tracks estimated context token usage across the session. At configurable thresholds, issues warnings to the agent and tightens compression:

| Phase | Threshold | maxLines | Behavior |
|---|---|---|---|
| Normal | <70% | 50 | Standard compression |
| Warn | ≥70% | 35 | Injects `[Context at ~70% — compression may become aggressive]` |
| Aggressive | ≥85% | 20 | Injects warning, skips generic on low-ROI commands |
| Critical | ≥95% | 5 | Injects `[Context critically full — consider compacting]` |

Config:
```json
{
  "adaptivePressure": {
    "enabled": false,
    "warnThreshold": 0.7,
    "aggressiveThreshold": 0.85,
    "criticalThreshold": 0.95
  }
}
```

Phase transitions logged to compress.log as `pressure-warn`, `pressure-aggressive`, `pressure-critical`.

### Relevance Trimming (`commandCompression.relevanceTrimming*`)

TF-IDF scoring of each output line against command query terms. Lines with scores below `relevanceTrimmingThreshold` (default 0.15) are dropped unless they're among the top `relevanceTrimmingAlwaysKeepTop` lines or we haven't hit `relevanceTrimmingMinKeep` yet. Only applied when the trimmed output is at least 10% smaller than the original. Config:

```json
{
  "commandCompression": {
    "relevanceTrimmingEnabled": false,
    "relevanceTrimmingThreshold": 0.15,
    "relevanceTrimmingMinKeep": 5,
    "relevanceTrimmingAlwaysKeepTop": 3
  }
}
```

Opt-in (default false). Logged as `relevance-trim` with dropped line count.

### Delta Compression (`commandCompression.deltaCompression*`)

When a command runs multiple times and the new output is at least `deltaMinSimilarity` (default 0.5) similar to the cached previous output, only the differing lines are emitted. The delta shows removed prefix lines (`- N lines`), new/changed content, and appended suffix lines (`+ N lines`). Cache retained per command (max `deltaMaxCacheSize`).

```json
{
  "commandCompression": {
    "deltaCompressionEnabled": true,
    "deltaMaxCacheSize": 50,
    "deltaMinSimilarity": 0.5
  }
}
```

Enabled by default. Falls through to normal compression when similarity is below threshold. Logged as `delta` with strategy label.

### Output Offloading (`outputOffloading`)

When compressed output still exceeds 8K chars (configurable), the full compressed content is written to `~/.config/opencode/scratch/<hash>.out` and replaced with a reference banner. Old scratch files are purged after 24h. Config:

```json
{
  "outputOffloading": {
    "enabled": true,
    "thresholdChars": 8000
  }
}
```

## Output Token Control (`outputTokenControl`)

Injects a `<system_reminder type="suggestion">` rule into the system prompt that constrains the agent's response length. Output tokens cost 4-8× more than input tokens across all major providers, so reducing response verbosity saves the most expensive token type.

### How it works

The `experimental.chat.system.transform` hook appends a concise-output rule after the static system prompt. The rule text depends on the configured `mode` and current context pressure level (shared with `adaptivePressure` state).

| Mode | Behavior |
|---|---|
| `adaptive` | Rule tightens as context fills: normal → warn → aggressive → critical |
| `always-on` | Same rule injected every turn (uses normal-level settings) |
| `off` | No injection |

### Strategies

| Strategy | Example output |
|---|---|
| `concise` | *"Be concise. Prefer bullet points. Answer in at most 5 sentences. Skip introductions."* |
| `sentence_limit` | *"Answer in at most 3 sentences."* |
| `char_limit` | *"Answer in at most 200 characters. Be extremely concise."* |
| `bullet_only` | *"Use bullet points only. No paragraphs or prose."* |
| `custom` | Exact text from `customPrompt` field |

### Per-level overrides

Each adaptive level has its own `{strategy}`, `{sentences}`, and `{prompt}` fields. Critical defaults to `char_limit` with 1 sentence; warn defaults to `sentence_limit` with 3 sentences.

### Exclusion

`excludePatterns` is a list of regex patterns. If the user message matches, the rule is skipped — useful for queries that explicitly ask for detailed explanations.

### Config defaults

```json
{
  "outputTokenControl": {
    "enabled": false,
    "mode": "adaptive",
    "strategy": "concise",
    "maxSentences": 5,
    "maxChars": 0,
    "customPrompt": "",
    "warnThreshold": 0.7,
    "aggressiveThreshold": 0.85,
    "criticalThreshold": 0.95,
    "normalSentences": 5,
    "warnSentences": 3,
    "aggressiveSentences": 1,
    "criticalSentences": 1,
    "normalStrategy": "concise",
    "warnStrategy": "sentence_limit",
    "aggressiveStrategy": "sentence_limit",
    "criticalStrategy": "char_limit",
    "normalPrompt": "",
    "warnPrompt": "",
    "aggressivePrompt": "",
    "criticalPrompt": "",
    "excludePatterns": []
  }
}
```

Logged to compress.log as `output-token-control` with level and rule text snippet.


### Re-Read Elimination (`reReadElimination`)

In `tool.execute.before` for `read` commands. When a file was previously read and its mtime hasn't changed, the cached content is served with `[File unchanged since turn N]` banner, eliminating redundant disk reads and token usage. Logged to filesum.log with component `RE-READ`. Config:

```json
{
  "reReadElimination": {
    "enabled": true,
    "maxCacheSize": 100
  }
}
```

## Development Install (critical — cache or it won't work)

OpenCode loads from plugin cache, NOT from node_modules. Both steps required:

```bash
bun run build         # compile TS
npm pack              # create .tgz
cd ~/.config/opencode
npm install --ignore-scripts /path/to/opencode-fractal-memory-0.6.34.tgz
cp -r node_modules/opencode-fractal-memory/dist \
  node_modules/opencode-fractal-memory/management \
  node_modules/opencode-fractal-memory/package.json \
  node_modules/opencode-fractal-memory/LICENSE \
  node_modules/opencode-fractal-memory/commands \
  node_modules/opencode-fractal-memory/agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

Quick iteration (no package.json changes):
```bash
bun run build && cp -r dist management package.json LICENSE README.md commands agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

Then restart OpenCode.

## Key Files

| File | Purpose |
|---|---|---|
| `src/config.ts` | MemConfig interface + Zod schema + defaults |
| `src/hooks/compress-output.ts` | 7 compression strategies + generic fallback |
| `src/hooks/skeletonize.ts` | Tree-sitter AST skeleton extraction (32 languages) + regex fallback |
| `src/hooks/auto-retrieve/index.ts` | Multi-reasoning reranking pipeline (agent-pull model) |
| `src/hooks/auto-retrieve/scoring.ts` | Fallback scoring (metadata + keyword overlap, no embeddings) |
| `src/plugin/hooks.ts` | **Thin orchestration** — calls 9 extracted handlers |
| `src/plugin/hooks/types.ts` | HookHandler interface for the pipeline pattern |
| `src/plugin/hooks/recording.ts` | Memory tool call recording + predictive rating |
| `src/plugin/hooks/working-cache.ts` | Populate working cache from memory tool results |
| `src/plugin/hooks/compression.ts` | Command output compression + feature banner |
| `src/plugin/hooks/skeletonization.ts` | File read skeletonization + feature banner |
| `src/plugin/hooks/file-summary.ts` | Auto-file-summarization (before + after hooks) |
| `src/plugin/hooks/seed-rules.ts` | Rule node loading + system transform injection |
| `src/plugin/hooks/compaction.ts` | Middle-term capture + stored context archiving |
| `src/plugin/hooks/events.ts` | Session lifecycle event handling |
| `src/seed-nodes.ts` | Seed nodes including `rule:feature:*` visibility rules |
| `src/storage/sqlite.ts` | SqliteMemoryStore class |
| `src/management/routes.ts` | API routes (config, nodes, compression, injection quality, backup) |
| `management/public/index.html` | Management app UI |
| `management/public/app.js` | Management app JS (loadSettings, saveConfig, loadCompressStats) |
| `src/storage/migrations/definitions.ts` | DB migrations (v25 = compression_stats) |
| `src/logging.ts` | Per-feature logging (`writeMemLog`, `writeFileSumLog`, `writeCompressLog`) |
| `install-dev.md` | Full install guide |
| `src/hooks/output-token-control.ts` | Output token control — rule generation + exclusion logic |
| `src/plugin/hooks/output-token-control.ts` | Output token control handler + system transform injection |
| `src/hooks/re-read-elimination.ts` | Read cache + mtime check |
| `src/hooks/adaptive-pressure.ts` | Token estimation + pressure phase tracking |
| `src/management/helpers.ts` | withDb, rowToNode, JSON serialization helpers |
| `src/management-standalone.ts` | Management server entry point (separate subprocess) |

## Config default for commandCompression

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

## Config default for fileSkeletonization

```json
{
  "fileSkeletonization": {
    "enabled": true,
    "minLines": 200,
    "strategy": "ast+regex"
  }
}
```

## Rules

- Always cp to BOTH node_modules AND cache when installing
- Migration version in definitions.ts must increment; never modify existing migrations
- Management app config fields: id=kebab-case in HTML, load/save in app.js with same pattern
- Strategy name in compress-output.ts must be a short string (ls, test, grep, git-status, git-log, git-diff, git-quick, truncate, generic)
- Skeletonize strategy name in skeletonize.ts must be one of: ast-only, regex-only, ast+regex
- Management app config fields for fileSkeletonization follow same kebab-case pattern (file-skeletonization-enabled, file-skeletonization-min-lines, file-skeletonization-strategy)
- When adding new log files, add write function to src/logging.ts, register in the section map, and create the file path constant

## Critical Memory Nodes

Use `memory_drilldown(label="<label>")` to retrieve full context for these key nodes:

| Label | Type | Why it matters |
|---|---|---|
| `knowledge:management-app-architecture` | knowledge | Full breakdown of management app structure, API, tab system |
| `auto-retrieve-status` | summary | Current state of auto-retrieve pipeline, scores, config |
| `implementation-plan` | howto | Full architectural improvement plan (all phases) |
| `architectural-review-plan` | howto | Architecture scoring, bottlenecks, recommendations |
| `bug:three-bugs-2026-06-15` | fix | Three bugs fixed + their root causes |
| `rule:mandatory:memory` | rule | Memory tool usage rules (search→get→set chain, etc.) |
| `rule:mandatory:agent-pull` | rule | Agent-pull model — no auto-injection |
| `enhancements-llm-compress-auto-distill-predictive-rating` | note | Three enhancements implementation details |
| `ollama-memory-feature` | note | Ollama-based local memory system |
| `middle_term_context_implementation_complete` | implementation | Middle-term context capture implementation |
| `memory-injection-improvements-findings-2026-04-19` | research | Context injection improvement research |
| `memory-efficiency-research-findings` | research | Memory efficiency optimization findings |
| `procedural-memory-implementation` | summary | Procedural memory implementation details |
| `injection-scoring-improved` | note | Improved injection scoring with relevance-budget selector |
| `auto-retrieve-fix-complete` | note | Auto-retrieve fix details |
| `file:src/plugin/hooks.ts` | file | Hook wiring — compression, file summary, rules, lifecycle |
| `file:src/hooks/compress-output.ts` | file | Compression implementation (7 strategies + generic) |
| `file:src/management/routes.ts` | file | All API route handlers |
| `file:management/public/app.js` | file | Management app JS (loadSettings, saveConfig, loadCompressStats) |
| `file:management/public/index.html` | file | Management app HTML (tabs, settings panels, compress panel) |
| `enhancements-llm-compress-auto-distill-predictive-rating` | note | Three enhancements implementation details |
| `ollama-memory-feature` | note | Ollama-based local memory system |
| `bug:three-bugs-2026-06-15` | fix | Three bugs fixed + their root causes |
| `rule:mandatory:agent-pull` | rule | Agent-pull model — no auto-injection |
| `rule:feature:command-compression` | rule | Compression feature details — 7 strategies, banners |
| `rule:feature:file-skeletonization` | rule | Skeletonization feature details — tree-sitter, banners |
| `rule:feature:file-summarization` | rule | File summary feature details — auto-store on read |
| `rule:feature:auto-retrieve` | rule | Auto-retrieve reranking feature details |
| `file:src/plugin/hooks.ts` | file | Thin orchestration — calls 9 extracted handlers |
| `file:src/plugin/hooks/compression.ts` | file | Compression handler with feature banner |
| `file:src/plugin/hooks/skeletonization.ts` | file | Skeletonization handler with feature banner |
| `file:src/plugin/hooks/file-summary.ts` | file | Before/after hooks for auto-file-summarization |
| `file:src/plugin/hooks/seed-rules.ts` | file | Rule loading + rule:feature injection |
| `file:src/plugin/hooks/working-cache.ts` | file | Working cache population from tool results |
| `file:src/plugin/hooks/recording.ts` | file | Memory tool call recording + predictive rating |
| `file:src/plugin/hooks/compaction.ts` | file | Middle-term capture + stored context |
| `file:src/plugin/hooks/events.ts` | file | Session lifecycle event handling |
| `task:compress-before-after-stats-2026-06-23` | task | Before/after compression stats implementation details |
| `task:context-dashboard-2026-06-23` | task | Context dashboard implementation details |
| `output-token-control` | howto | Output token control feature — config, strategies, levels |
| `sdk-llm-judge-auto-retrieve` | note | LLM judge scoring via client.session.prompt({noReply:true}) for auto-retrieve reranking |
| `memory-llm-compress-session-fix` | note | sessionId threading fix for memory_llm_compress generateLLMSummary |
