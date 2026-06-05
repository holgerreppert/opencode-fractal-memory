# opencode-fractal-memory

Fractal memory system for [OpenCode](https://opencode.ai) with semantic search, automatic compression, and multi-level retrieval.

# about me and the usage

I made this because I needed a longterm memory at first.
Then while working with it I extended it's functionality.
It might be a little bit overwhelming but if you work with it you will
start to love it.
You can tell the coding agent to make a memory of everything.
And later on you can tell it to read it.
You can also use the management app that includes a nice threejs visualization
and searching from there in the memory nodes.
You can also inject nodes directly to the agent from there.
You can edit the nodes too.
I think I forgot to mention some of features here.
I'll update this project constantly.
Feel free to use it and tell me how much you hate or like it ;)

Have phun

Holger

PS.: Did I mention that this is alpha? So feel free to post issues with suggestions
if you find bugs or if you just want to suggest improvements 


## Features

- **Memory nodes** — structured persistent memory with labels, content, metadata, and type system
- **Semantic search** — ONNX-powered embeddings (all-MiniLM-L6-v2) with HNSW vector index for fast ANN retrieval
- **BM25 full-text search** — keyword search as a fallback, hybrid-scored with embeddings for best results
- **Fractal retrieval** — drill-down from high-level summaries to granular details
- **Automatic compression** — periodically summarizes low-level nodes into progressively higher-level abstractions (4 levels)
- **Auto-retrieve** — context-aware injection of relevant memories, skills, and playbooks into the prompt
- **Ollama reranking** — re-ranks memory search results with a local LLM for better relevance
- **LLM compression** — uses LLM to generate richer summaries instead of regex extraction
- **Auto-distill** — automatically extracts actionable rules from lesson nodes
- **Predictive rating** — adjusts memory usefulness scores over time based on usage patterns
- **Cache system** — in-memory LRU cache for frequently accessed nodes with configurable TTL
- **Journal** — append-only searchable journal entries with semantic search
- **Playbooks** — reusable workflow templates (sticky memory nodes) proposed by the agent
- **Management server** — local web UI (port 8787) for browsing, searching, and editing memory
- **Sub-agents** — `memory-hints` and `memory-researcher` agents for guided memory interaction

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

Create `~/.config/opencode/opencode-mem.json` to customize (optional — all defaults work out of the box):

```json
{
  "autoRetrieve": {
    "enabled": true,
    "candidateCount": 30,
    "maxInjectNodes": 5,
    "maxInjectPlaybooks": 3
  },
  "ollama": {
    "enabled": false,
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5-coder:1.5b",
    "mode": "binary"
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
  "predictiveRating": {
    "enabled": false,
    "decayDays": 7,
    "confidenceThreshold": 0.3,
    "positiveBoost": 0.1,
    "negativePenalty": 0.05
  },
  "maxInjectionTokens": 8000,
  "coreInjectionTokens": 2000,
  "cacheSize": 8,
  "cacheTTLHours": 2,
  "autoCompressThreshold": 0.7,
  "highContextThreshold": 0.6,
  "criticalContextThreshold": 0.8,
  "defaultTtlDays": 0,
  "enableMiddleTermCapture": true
}
```

### Config reference

| Field | Type | Default | Description |
|---|---|---|---|---|
| `autoRetrieve.enabled` | bool | `false` | Enable automatic memory injection into prompts |
| `autoRetrieve.candidateCount` | int | `30` | Number of candidates to fetch for injection |
| `autoRetrieve.maxInjectNodes` | int | `5` | Max memory nodes to inject per turn |
| `autoRetrieve.maxInjectPlaybooks` | int | `3` | Max matching playbooks to list |
| `ollama.enabled` | bool | `false` | Use local LLM for reranking search results |
| `ollama.baseUrl` | string | `http://localhost:11434` | Ollama server URL |
| `ollama.model` | string | `qwen2.5-coder:1.5b` | Model for reranking |
| `ollama.mode` | enum | `"binary"` | `"binary"` (relevant/not) or `"score"` (0-1 rating) |
| `llmCompression.enabled` | bool | `false` | Use LLM for richer compression summaries |
| `llmCompression.model` | string | _none_ | LLM model name (uses ollama if not set) |
| `llmCompression.maxSummaryTokens` | int | `500` | Max tokens per LLM-generated summary |
| `autoDistill.enabled` | bool | `false` | Auto-extract rules from lesson nodes |
| `autoDistill.minLessons` | int | `3` | Min lessons before extraction |
| `autoDistill.useLlm` | bool | `false` | Use LLM for more specific rules |
| `predictiveRating.enabled` | bool | `false` | Auto-decay and boost node usefulness |
| `predictiveRating.decayDays` | int | `7` | Days until usefulness decay |
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
| `autoFileSummarization.enabled` | bool | `false` | Auto-summarize files on read |

## Advanced Features

### Ollama Reranking

When enabled in config, auto-retrieve results are re-ranked by a local LLM (via Ollama) for better relevance. The reranker scores candidates against the user's query and only keeps the most relevant ones:

```json
{
  "ollama": {
    "enabled": true,
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5-coder:1.5b",
    "mode": "binary"
  }
}
```

In `"binary"` mode, the LLM labels each candidate as relevant or not. In `"score"` mode, it assigns a 0-1 relevance score.

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

### Predictive Rating

Automatically adjusts node usefulness scores over time. Frequently accessed nodes get boosted; nodes that haven't been touched in `decayDays` get gradually decayed:

```json
{
  "predictiveRating": {
    "enabled": true,
    "decayDays": 7,
    "confidenceThreshold": 0.3,
    "positiveBoost": 0.1,
    "negativePenalty": 0.05
  }
}
```

## Commands

### Memory tools

| Command | Description |
|---|---|
| `memory_set` | Create or update a memory node |
| `memory_get` | Get a single node by ID or label |
| `memory_fetch` | Fetch a node by exact label |
| `memory_search` | Search nodes by text, embedding, or BM25 |
| `memory_delete` | Delete a node by ID or label |
| `memory_list` | List nodes with optional scope/level filters |
| `memory_replace` | Replace content in a memory node |
| `memory_rate` | Rate a node's usefulness (helps ranking) |
| `memory_prune` | Find and remove stale/unused nodes |
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

When the MCP server is configured, the `memory_search`, `memory_get`, and related tools are available as MCP resources for IDE integration.

## Skills

Skills are specialized instruction sets stored as memory nodes. When a task matches a skill's trigger keywords, its instructions load into context to guide the agent.

### Available skills

| Skill | Triggers |
|---|---|
| `debug-workflow` | bug, error, fix, crash |
| `write-tests` | tests, coverage, test suites |
| `refactor-component` | refactor, restructure, clean up |
| `refactoring-expert` | SOLID, code smell, technical debt |
| `security-review` | security, audit, vulnerability, deploy |
| `threejs-skills` | 3D, WebGL, visualization |
| `svelte-core-bestpractices` | svelte, component, runes |
| `svelte-code-writer` | svelte 5, sveltekit, component |
| `customize-opencode` | opencode config, agent, plugin |
| `context-engineering` | context, prompt, system message |
| `git-workflow-and-versioning` | git, commit, branch, version, publish |
| `incremental-implementation` | step by step, increment, gradual |

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

The server starts automatically when `management.enabled: true` is set in your config (see [Configuration](#configuration)), or manually:

```bash
bun run view
```

Opens at [http://localhost:8787](http://localhost:8787). The server starts as a background process and auto-stops on plugin shutdown.

### Usage

**3D Graph** — the default view shows memory nodes as spheres connected by `[[wiki-link]]` relationships:
- **Drag** to rotate the scene
- **Scroll** to zoom in/out
- **Left-click** a node to select and inspect it
- **Right-click drag** to pan
- Nodes are color-coded by type (note, skill, playbook, rule)

**Search** — find nodes by content, label, or type:
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

## How Plugin Initialization Works

When OpenCode loads the plugin, `initStorage()` runs automatically:

1. **SQLite database** — created at `<project>/.opencode/memory.db` with all tables and indexes
2. **Seed nodes** — rule nodes, built-in playbooks (6), and skills (9) inserted into `memory_nodes`
3. **Model files** — `ensureModels()` checks `~/.config/opencode/models/` and downloads ONNX + tokenizer (~24 MB) if missing
4. **Agent files** — `ensureAgentFiles()` copies `agent/` directory to `~/.config/opencode/agent/`
5. **Command files** — `ensureCommandFiles()` copies `commands/` directory to `~/.config/opencode/commands/`
6. **Background embeddings** — after 1s, generates embeddings for nodes that lack them
7. **Auto-retrieve hook** — if enabled in config, injects relevant context into prompts

Every initialization step is logged with timing in `logs/memory-plugin.log`, making it easy to diagnose startup issues.

All of this happens automatically — no manual intervention required.

## Logs

All plugin logs are consolidated under `~/.config/opencode/logs/`:

| Log | Path | Contents |
|-----|------|----------|
| Plugin | `logs/memory-plugin.log` | Plugin operations, init steps with timing, auto-retrieve, session events |
| MCP server | `logs/mcp-server.log` | MCP tool calls, resources, errors |
| Injection debug | `logs/memory-injection.log` | Full auto-retrieve injection payloads (rotated at 1 MB) |
| Context dump | `logs/context-dump.log` | Full context snapshots for debugging |
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
┌──────────────────────────────────────────────────┐
│  Plugin Layer (plugin/index.ts)                   │
│  ┌──────────┬──────────┬──────────┬───────────┐  │
│  │ Memory    │ Skills   │ Journal  │ Auto-     │  │
│  │ Store     │ (nodes)  │ Store    │ Retrieve  │  │
│  └────┬─────┴────┬─────┴────┬─────┴─────┬─────┘  │
│       │          │          │           │         │
│  ┌────┴──────────┴──────────┴───────────┴─────┐  │
│  │ SQLite (.opencode/memory.db)                │  │
│  │  - memory_nodes (labels, content, embeds)   │  │
│  │    - type: "note" / "skill" / "playbook"   │  │
│  │    - sticky playbooks/skills never pruned   │  │
│  │    - metadata.steps for playbook steps      │  │
│  │  - memory_links (wiki-link crossrefs)       │  │
│  │  - bm25_index (full-text search)            │  │
│  │  - injection_metrics / session_metrics      │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ HNSW Vector Index (in-memory, 384-dim)      │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ ONNX Embedding Model (all-MiniLM-L6-v2)     │  │
│  │ onnxruntime-web + @huggingface/tokenizers   │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## Storage

Two SQLite databases:

| Scope | Path | Purpose |
|---|---|---|
| Global | `~/.config/opencode/memory.db` | Rules, persona, preferences, shared across projects |
| Project | `<project>/.opencode/memory.db` | Project-specific memory, nodes, playbooks, journal |

## License

MIT
