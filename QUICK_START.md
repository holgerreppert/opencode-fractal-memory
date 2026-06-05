# opencode-fractal-memory Quick Start

## Core Concept

The memory system uses **auto-retrieve** — relevant context is automatically injected into the prompt based on the conversation. The agent also explicitly searches when needed. Playbooks and skills are stored as memory nodes and auto-detected when triggers match.

## Basic Workflow

1. **Start a task** → Auto-retrieve injects relevant memories, playbooks, and skills
2. **Make decisions** → Agent stores important patterns with `memory_set`
3. **Complete work** → Agent rates usefulness of memories used

## Memory Commands

### Search for Context
```
memory_search { query: "your search terms" }
```
Returns semantically similar nodes with relevance scores.

### Get Full Node Content
```
memory_drilldown { id: "node-id" }
```
Shows full content + path to source nodes (fractal retrieval).

### Store Important Information
```
memory_set {
  content: "Key information to remember",
  label: "descriptive-label",
  importance: 0.8,
  type: "note"
}
```

### Load a Skill
```
memory_skill_load(name="debug-workflow")
```
Loads full skill instructions into context.

### Execute a Playbook
```
memory_playbook_execute(playbook_id="playbook:debug-workflow")
```
Returns ordered steps for the agent to execute.

### Check System Health
```
memory_stats
memory_dashboard
```

## Available Skills

Skills are auto-injected when triggers match the task. Load explicitly with `memory_skill_load`:

| Skill | When |
|---|---|
| `debug-workflow` | Debugging errors or investigating failures |
| `write-tests` | Adding tests or improving coverage |
| `refactoring-expert` | Restructuring code or cleaning up |
| `code-simplification` | Reducing complexity |
| `security-review` | Security audit or before deployment |
| `shipping-and-launch` | Deploying to production |
| `svelte-core-bestpractices` | Writing Svelte components |

List all skills with `memory_search({ type: "skill" })`.

## Available Playbooks

Playbooks are reusable workflows stored as sticky memory nodes (type: `"playbook"`). The agent proposes playbook creation when it spots repeated multi-step patterns. Six built-in playbooks:

| Playbook | Steps |
|---|---|
| `playbook:debug-workflow` | Reproduce → Isolate → Fix → Verify |
| `playbook:write-tests` | Study patterns → Read source → Write tests → Verify |
| `playbook:refactor-component` | Understand → Baseline → Refactor incrementally → Verify |
| `playbook:code-review` | Read diff → Check tests → Review security → Suggest |
| `playbook:security-audit` | Check secrets → Validate input → Review auth → Audit deps |
| `playbook:plan-feature` | Clarify → Explore → Spec → Implement → Verify |

## Token Efficiency

| Operation | Tokens | When to Use |
|-----------|--------|-------------|
| `memory_search` | ~500 | Find specific info |
| `memory_stats` | ~133 | Check health |
| `memory_drilldown` | Variable | Compressed summaries |
| `memory_list` | ~3000+ | Avoid unless debugging |
| `memory_skill_load` | ~500 | Load skill instructions |

## Best Practices

1. **Be selective** — Only store valuable information
2. **Use descriptive labels** — Easy to find later
3. **Rate usefulness** with `memory_rate` — Helps the system learn
4. **Use links** — Connect related nodes with `[[label]]`
5. **Search first** — Don't duplicate existing memories

## Management Viewer

Auto-starts when `management.enabled: true` is set in your config. To launch manually:

```bash
bun run view
```
Opens at http://localhost:8787

## Memory System Architecture

```
┌─────────────────────────────────────────────────────┐
│                OpenCode Agent                       │
├─────────────────────────────────────────────────────┤
│  auto-retrieve  →  injects relevant context         │
│  memory_set     →  store with embeddings            │
│  memory_skill_load → load skill instructions        │
│  memory_playbook_execute → run workflow steps       │
│  memory_drilldown → fractal retrieval               │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              SQLite Database                        │
│  ~/.config/opencode/memory.db (global)              │
│  .opencode/memory.db (project)                      │
├─────────────────────────────────────────────────────┤
│  memory_nodes (labels, content, embeds, metadata)   │
│    - type: "note" | "skill" | "playbook"           │
│    - sticky: true (playbooks/skills never pruned)   │
│    - metadata.steps (playbook steps)                │
│  memory_links ([[wiki-link]] cross-references)      │
│  bm25_index (full-text search)                      │
│  injection_metrics / session_metrics                │
│  Levels: L0 (raw) → L1 (summaries) → L2+           │
│  Compression triggers at 70% context                │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  HNSW Vector Index (in-memory, 384-dim)             │
│  ONNX Embedding Model (all-MiniLM-L6-v2)            │
│  onnxruntime-web + @huggingface/tokenizers          │
│  (~24 MB, downloaded to ~/.config/opencode/models)  │
└─────────────────────────────────────────────────────┘
```

## Model Files

Embedding models (~24 MB) are downloaded automatically:
- On first plugin load (via `ensureModels()` in initialization)
- Also available via `postinstall` during `npm install`
- Stored at `~/.config/opencode/models/Xenova/all-MiniLM-L6-v2/`

## Tips

- Use `memory_verify` to boost confidence on important nodes
- Use `memory_prune` to clean up stale nodes periodically
- Use `memory_compress` to group related nodes into summaries
- Check `memory_dashboard` for system health metrics
- Use `memory_injection_debug` to see what was injected last session
