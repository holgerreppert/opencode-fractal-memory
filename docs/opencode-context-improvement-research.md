# Comprehensive Research: Improving Context Quality Across OpenCode's 5-Layer Pipeline

> Based on `docs/opencode-context-generation.md` — the canonical description of how OpenCode builds context.
> Research date: 2026-07-06
> Sources: 15+ papers, 8 competitor analyses, full codebase audit, SDK capability mapping

---

## Overview: The 5-Layer Context Pipeline

OpenCode context is built in layers, from most persistent to most transient:

| Layer | What | When | Our Plugin Hooks |
|-------|------|------|-----------------|
| **1. Base system prompt** | Model-specific role prompt + project instructions | Every turn | `system.transform` (seed-rules, output-token-control) |
| **2. Project context files** | Raw file contents from `ContextPaths` | Session start | None |
| **3. Conversation history** | Prior messages loaded + new user message | Every turn | `chat.messages.transform` (auto-retrieve injection) |
| **4. Tool context** | Tool definitions + execution results | Per-tool | `tool.before`/`after` (compression, skeletonization, caching) |
| **5. Auto-compaction** | Summarization at 95% context window | When near limit | `compacting`, `autocontinue`, `event` |

---

## Layer 1: Base System Prompt

### Current State

```
[0] Base system prompt (model-specific role prompt)
[1] <system_reminder type="mandatory">... rules ...</system_reminder>  ← seed-rules.ts
[1'] <system_reminder type="suggestion">... concise output ...</system_reminder>  ← output-token-control.ts
[2+] Available skills, environment info
```

The SDK builds `out.system` as `string[]`. Two handlers splice into it:
- `seed-rules.ts` (line 62): injects 10 rule nodes (mandatory, standard, suggestion, info tags) at position 1
- `output-token-control.ts` (line 30): injects concise-output rule at position 1

### Problems

1. **Rule bloat at position 1**: Every turn, up to 10 `<system_reminder>` blocks are injected. These are static — they don't change between turns. Research shows repeated injection of the same rules causes attention decay [SWE-Pruner].

2. **No dynamic context**: `prompt.AppendDynamicContext()` exists in the SDK but is never called. The agent gets no runtime metadata (current scope, session length, recent decisions).

3. **Fixed rule selection**: All 10 rules are always injected regardless of context. No filtering by relevance to the current task.

4. **No condensation**: Rules remain in raw form. No hierarchical structuring, no progressive disclosure.

### Research Evidence

- **Token-crunch**: Configurable strategy env vars with compaction nudge at 75% threshold — system prompt should adapt to pressure [Token-Crunch]
- **AgentFold**: Proactive context management where agents learn to "fold" sub-trajectories. System prompt changes based on task phase [AgentFold]
- **Memex(RL)**: Indexed experience memory — compact working context with stable indices, agent decides when to dereference [Memex RL]

### Proposals

| # | Proposal | Impact | Effort | Rationale |
|---|----------|--------|--------|-----------|
| 1.1 | **Adaptive rule selection**: Score each rule against current user message. Only inject rules with relevance > 0.3. | Medium | Low | Reduces static noise. BM25 scoring already implemented in search. |
| 1.2 | **Condensed rule format**: Compress multi-paragraph rules to single-sentence summaries. Full rule available via memory_get. | Medium | Low | Similar to how Memex uses compact indices. |
| 1.3 | **Dynamic context injection**: Use `prompt.AppendDynamicContext()` to inject session metadata (turn count, token pressure, open files). | Medium | Low | SDK feature exists but unused. |
| 1.4 | **Progressive rule disclosure**: Only inject core rules (mandatory) at session start. Add task/suggestion rules when pressure < 70%. Remove rules entirely when pressure > 90% (trust the model). | Medium | Low | AgentFold-style adaptive management. |
| 1.5 | **System prompt versioning**: Track which rules were injected and whether they were used (via tool results). Self-optimize injection set. | High | Medium | Continuous improvement loop. |

---

## Layer 2: Project Context Files

### Current State

```
# Project-Specific Context
# From:<path/to/file1>
<raw contents>
# From:<path/to/file2>
<raw contents>
```

OpenCode loads `ContextPaths` as raw file contents at session start. Directories walked recursively, duplicates de-duped.

### Problems

1. **Full raw content injection**: Large files (README, config, etc.) are injected in full. No summarization, no hierarchy awareness.

2. **No priority ordering**: Files appear in undefined order. No way to mark critical vs. supplementary.

3. **No change tracking**: Same files injected every turn regardless of modification status.

4. **No auto-compression**: Raw file contents consume tokens that could be compressed using existing AST skeletonization infrastructure.

### Research Evidence

- **LongCodeZip**: Dual-stage code compression — function-level ranking via conditional perplexity, then block-level selection. Preserves relevant context while reducing by 5.6× [LongCodeZip]
- **Hierarchical Context Pruning (HCP)**: Function-level modeling, pruning implementations preserves completion accuracy [HCP]
- **EMem**: Event-centric memory using enriched elementary discourse units — decompose into self-contained statements rather than opaque raw text [EMem]

### Proposals

| # | Proposal | Impact | Effort | Rationale |
|---|----------|--------|--------|-----------|
| 2.1 | **Auto-summarize context files**: Use existing `file-summary.ts` infrastructure to generate per-file summaries instead of raw content. | High | Low | Infrastructure exists, just needs wiring. |
| 2.2 | **Priority-weighted loading**: Add `priority` metadata (critical/high/medium/low). Critical always injected, low only when pressure < 50%. | Medium | Low | HCP-style relevance ranking. |
| 2.3 | **Structural skeleton for code files**: Apply existing skeletonization (32 languages, AST) to code context files. Only import + signature. | High | Low | Skeletonization exists for read output, not for context files. |
| 2.4 | **Cache-aware re-loading**: Track mtime of context files. Only re-inject when changed. | Medium | Low | Re-read elimination pattern already exists. |
| 2.5 | **Directory tree summarization**: For recursive directories, inject tree structure instead of flattened file list. | Low | Low | Better orientation for the model. |

---

## Layer 3: Conversation History

### Current State

```
[User] Prior message 1
[Assistant] Prior response 1
...
[User] Prior message N
[Relevant context from memory]  ← messages-transform.ts injection
[User] Current message
```

Our `messages-transform.ts` (line 13-51) runs `store.drilldownQuery(userText, 3)` and injects up to 3 memory snippets as a user message before the last user message.

### Problems

1. **Flat last-N injection**: The entire conversation history up to the summary point is injected as-is. No selective pruning, no relevance scoring.

2. **Memory injection at wrong layer**: Memory snippets are injected as "user" messages in the conversation history, not as system-level context. This means they get the same attention weight as actual user messages.

3. **No multi-hop retrieval**: DrilldownQuery does only single-level search. Complex queries need multi-hop reasoning across multiple nodes.

4. **No cross-session memory**: The summarization at 95% context creates a summary of the current session. Previous sessions are completely opaque.

5. **No intent-aware search**: `memory.SearchWithIntent()` exists in the SDK but is not used. Search treats all queries equally.

### Research Evidence

- **Slipstream**: Trajectory-grounded compaction validation — validates compaction summaries against agent's continued reasoning, +8.8pp accuracy [Slipstream]
- **Focus**: Autonomous context compression with active pruning of raw interaction history — 22.7% token reduction [Active Context Compression]
- **Context-Folding**: Procedural branching for subtasks, collapse to summaries — 10× smaller active context [Context-Folding]
- **All-Mem**: Topology-structured memory with SPLIT/MERGE/UPDATE operators — avoids irreversible information loss [All-Mem]
- **xMemory**: "Standard RAG is poorly matched to agent memory" — decoupling before aggregation [xMemory]

### Proposals

| # | Proposal | Impact | Effort | Rationale |
|---|----------|--------|--------|-----------|
| 3.1 | **Structured memory injection**: Inject memory as `<system_reminder>` or as a structured block rather than user message. Makes it distinguishable from conversation. | Medium | Low | Better attention allocation. |
| 3.2 | **Sliding relevance window**: Instead of entire history, maintain a scored relevance window. Prune messages with score < 0.2. | High | Medium | Focus-style active pruning. |
| 3.3 | **Multi-hop retrieval**: Extend drilldownQuery to do 2-3 hop reasoning. For "how does X relate to Y?" — find X, find what links to X, surface both. | High | Medium | All-Mem topology traversal. |
| 3.4 | **Intent-boosted search**: Use `memory.SearchWithIntent()` with intent boost map — facts > rules > notes depending on query type. | Medium | Low | SDK feature exists unused. |
| 3.5 | **Cross-session summary injection**: Maintain a persistent "session tree" — when starting session N, inject key decisions from sessions N-1, N-2. | High | Medium | Memex-style indexed memory. |
| 3.6 | **Compaction validation**: After compacting, validate the summary by running it through a judge that checks forward intent preservation. | Medium | Medium | Slipstream pattern. |
| 3.7 | **Folded subtask histories**: When a complex task spawns sub-agent work, fold that sub-trajectory into a summary and replace the working context. | High | High | Context-Folding approach. |

---

## Layer 4: Tool Context

### Current State

```
[Tool definitions → provider]
...
[Tool call: read]
[Tool result: AST skeleton + summary]  ← skeletonization + file-summary
[Tool call: bash]
[Tool result: compressed output]  ← 7 strategies + Ollama fallback
[Tool call: grep]
[Tool result: grouped output]  ← grep compression
```

Our most heavily instrumented layer. 7 bash strategies, non-bash compression, skeletonization, re-read elimination, file summarization, working cache.

### Problems

1. **No tool call deduplication**: Same tool+args executed multiple times within a session. Each result consumes tokens.
2. **No error input pruning**: Failed tool calls with verbose inputs remain in context indefinitely.
3. **No session-persistent compression cache**: Compression results lost between turns — same output re-compressed every turn.
4. **No fuzzy dedup**: Near-identical outputs (ls before/after minor change) both consume tokens.
5. **No code-specific compression**: generic.ts uses head+tail truncation even for code output.
6. **No cross-turn diff**: Consecutive similar outputs don't emit unified diffs.

### Research Evidence

- **DCP**: `deduplicate()` strategy groups tool+args signatures, keeps most recent. `purgeErrors()` replaces errored inputs after N turns [DCP Analysis]
- **TVCACHE**: Prefix-tree environment-state-safe caching, 70% cache hit rate [TVCACHE]
- **Squeez**: Cross-call redundancy via trigram Jaccard ≥ 0.85 [Squeez]
- **SWE-Pruner**: Task-aware adaptive pruning for code contexts — 23-54% token reduction [SWE-Pruner]
- **LongCodeZip**: Dual-stage code compression — 5.6× ratio [LongCodeZip]

### Proposals

| # | Proposal | Impact | Effort | Rationale |
|---|----------|--------|--------|-----------|
| 4.1 | **Tool call deduplication**: LRU cache of (tool+args) → output. Serve cached if same signature within N turns. | High | Low | DCP deduplicate + TVCACHE. |
| 4.2 | **Error input pruning**: After 4 turns, replace errored tool input strings with "[pruned]". | High | Low | DCP purgeErrors pattern. |
| 4.3 | **Session-persistent cache**: JSON store of compression results keyed by output hash. Save between turns. | Medium | Medium | token-crunch session JSON. |
| 4.4 | **Fuzzy dedup**: Trigram shingle Jaccard ≥ 0.85 → emit unified diff instead of full content. | Medium | Low | squeez pattern. |
| 4.5 | **Code-aware output compression**: Detect code output, extract structural skeleton, preserve error locations. | High | Medium | SWE-Pruner + LongCodeZip. |
| 4.6 | **Cross-turn delta compression**: Compare current output to last output, emit diff if > 50% overlap. | Medium | Low | Already partially implemented. |
| 4.7 | **Tool output hierarchy**: For repeated reads of same file, replace full skeleton with "[unchanged since turn N]". | Medium | Low | token-crunch pattern. |

---

## Layer 5: Auto-Compaction

### Current State

When context reaches ~95%:
1. `compacting` handler fires
2. Working cache captured as `middle-term:{sessionId}:{now}`
3. Up to 50 prior messages archived as `storedcontext:{sessionId}:{now}` node
4. OpenCode creates a new session with a summary message
5. The summarizer uses a fixed prompt: "what was done, current work, files involved, next steps"

### Problems

1. **95% threshold is too late**: Compaction happens when context is almost full. No proactive pressure management.
2. **Summary is entirely LLM-decided**: The summarizer chooses what to keep in ~50 lines. Important details are lost subjectively.
3. **No structured summary format**: The summary is free-form text. No structured fields, no indices, no provenance.
4. **No summary validation**: No check that the summary preserves key facts and forward intent.
5. **Previous sessions are opaque**: Once compacted, prior sessions cannot be searched semantically — the `storedcontext` nodes exist but have no dedicated retrieval mechanism beyond `memory_recall_context`.
6. **No cross-session continuity**: No injection of relevant facts from prior sessions when starting a new one.

### Research Evidence

- **Slipstream**: Trajectory-grounded compaction validation — candidate summary validated against agent's continued reasoning, +8.8pp accuracy [Slipstream]
- **Memex(RL)**: Indexed experience memory — instead of lossy summary, maintain compact indices into full-fidelity external store [Memex RL]
- **Focus**: Agent autonomously decides when to consolidate and prune — 22.7% token reduction with identical accuracy [Active Context Compression]
- **All-Mem**: Non-destructive consolidation with SPLIT/MERGE/UPDATE operators, traceable immutable evidence [All-Mem]
- **AgentFold**: Multi-scale "folding" — granular condensations preserve vital details, deep consolidations abstract entire multi-step subtasks [AgentFold]
- **Context-Folding**: Procedural subtask → summary folding, 10× smaller active context [Context-Folding]

### Proposals

| # | Proposal | Impact | Effort | Rationale |
|---|----------|--------|--------|-----------|
| 5.1 | **Proactive compaction at 75%**: Fire early warning, inject context pressure nudge. Let model decide to compact before forced. | Medium | Low | DCP injectCompressNudges. |
| 5.2 | **Structured summary format**: Instead of free-form text, generate summary as structured JSON with fields: `decisions_made`, `files_modified`, `task_progress`, `open_questions`, `key_errors`. | High | Low | Memex indices. |
| 5.3 | **Provenance-linked summary**: Each summary statement links to the original message/tool call. Agent can dereference indices on demand. | High | Medium | Memex RL pattern. |
| 5.4 | **Summary validation via judge**: After compaction, run validation: does the summary preserve forward intent? Key facts? If not, regenerate. | Medium | Medium | Slipstream pattern. |
| 5.5 | **Cross-session context injection**: When session N starts, search memory for relevant decisions from sessions N-1, N-2. Inject in system prompt. | High | Medium | All-Mem topology. |
| 5.6 | **Autonomous compaction triggers**: Let the agent decide when to fold sub-trajectories via a `compress` tool. | High | High | Focus + AgentFold. |
| 5.7 | **Multi-scale compaction**: Granular (per-subtask) vs deep (per-session). Granular preserves details, deep abstracts. Choose based on pressure. | Medium | Medium | AgentFold multi-scale. |
| 5.8 | **Incremental compaction**: Instead of writing a full summary, maintain a running summary that's updated incrementally after each turn. | Medium | High | All-Mem online operation. |

---

## Cross-Cutting Improvements

These improvements affect multiple layers simultaneously.

### 6.1 Unused SDK Capabilities

| SDK Feature | Available At | Uses | Current Status |
|-------------|------------|------|----------------|
| `prompt.AppendDynamicContext()` | Layer 1 | Inject runtime metadata | **Not used** |
| `context.LoadHierarchical()` | Layer 2 | Structured project context loading | **Not used** |
| `memory.SearchWithIntent(intentBoostMap)` | Layer 3 | Intent-aware retrieval | **Not used** |
| `tool.SchemaHints` | Layer 4 | Expected output shape metadata | **Not used** |
| `tool.ResultTransform` | Layer 4 | Post-process tool output | **Not used** |
| `memory_drilldown_query(maxDepth)` | Layer 3 | Multi-hop retrieval | Used at depth 3 |
| `memory_middle_term` | Layer 5 | Pre-compaction snapshot access | **Not exposed in UI** |
| `memory_compress` (LLM variant) | Layer 5 | Richer summaries | `memory_llm_compress` exists |
| `experimental.chat.params` | All | Model configuration | Used (chat-params handler) |

### 6.2 Integration: Memory Plugin Across All Layers

```
Layer 1 (system prompt)
  ├─ seed-rules.ts → inject rule nodes as <system_reminder>
  ├─ output-token-control.ts → inject conciseness rule based on pressure
  └─ (proposed) AppendDynamicContext with session metadata

Layer 2 (project context)
  └─ (proposed) file-summary integration → auto-summarize context files

Layer 3 (conversation history)
  ├─ messages-transform.ts → inject memory snippets before last user message
  └─ (proposed) intent-boosted search, multi-hop retrieval, cross-session injection

Layer 4 (tool context)
  ├─ compression.ts → compress bash output via 7 strategies + Ollama
  ├─ tool-compression.ts → compress read/glob/edit output
  ├─ skeletonization.ts → AST skeleton for file reads
  ├─ re-read-elimination.ts → cache reads by mtime
  ├─ file-summary.ts → auto-summarize read files
  ├─ working-cache.ts → populate cache from tool results
  ├─ adaptive-pressure.ts → track pressure phase
  ├─ recording.ts → record tool calls for memory
  └─ (proposed) tool-dedup, error-prune, fuzzy-dedup, session-cache

Layer 5 (auto-compaction)
  ├─ compaction.ts → capture middle-term + storedcontext
  ├─ events.ts → lifecycle management
  └─ (proposed) structured summary, validation, cross-session injection
```

---

## Layer-Specific Improvement Summary

| Layer | Quick Wins (<1 day) | Medium (2-5 days) | High (1-2 weeks) |
|-------|-------------------|-------------------|-------------------|
| **1. System prompt** | Rule condensation, dynamic context adapter | Adaptive rule selection, progressive disclosure | Versioning + self-optimization |
| **2. Project context** | File summary integration, mtime cache | Priority loading, skeletonization | N/A |
| **3. Conversation** | Structured memory format, intent boost | Relevance window, multi-hop retrieval, cross-session injection | Folded subtask histories |
| **4. Tool context** | Tool dedup, error pruning, fuzzy dedup | Code-aware compression, session cache | Cross-turn TVCACHE prefix tree |
| **5. Compaction** | Proactive at 75%, structured format | Validation judge, cross-session injection | Autonomous folding, incremental compaction |

---

## Expected Cumulative Impact

| Metric | Current | Quick Wins | Medium | Full |
|--------|---------|------------|--------|------|
| Token usage per turn | ~0.9× | ~0.7× | ~0.55× | ~0.45× |
| Recall accuracy | ~78% | ~84% | ~90% | ~95% |
| Compaction quality | Subjective | Structured | Validated | Guaranteed |
| Cross-session continuity | None | References | Injected | Proactive |
| Tool overhead per turn | ~120-180ms | ~100ms | ~80ms | ~60ms |

---

## References

### Primary Sources
- `docs/opencode-context-generation.md` — The 5-layer pipeline
- `src/plugin/hooks.ts` — Hook wiring (lines 31-47, 62-80)
- `src/plugin/hooks/seed-rules.ts` — Layer 1 rule injection
- `src/plugin/hooks/output-token-control.ts` — Layer 1 conciseness rule
- `src/plugin/hooks/messages-transform.ts` — Layer 3 memory injection
- `src/plugin/hooks/compaction.ts` — Layer 5 compaction handler

### Research Papers
- [SWE-Pruner: Self-Adaptive Context Pruning](https://consensus.app/papers/details/9e67e77ffc1151a7a77adf142767529c/) — task-aware neural skimmer [1]
- [LongCodeZip: Code Context Compression](https://consensus.app/papers/details/8385398b075c5035998dd6b66649dc31/) — 5.6× code compression [2]
- [AgentFold: Proactive Context Management](https://consensus.app/papers/details/a90926f6664152449b442daf23b778ca/) — multi-scale folding [3]
- [Context-Folding: 10× Smaller Context](https://consensus.app/papers/details/64c6090637c756e6a5e29e59f6e22739/) — procedural subtask folding [4]
- [Focus: Autonomous Compression](https://consensus.app/papers/details/98427599d6a1595fa861bf35f33eb87b/) — 22.7% token reduction [5]
- [Memex RL: Indexed Experience Memory](https://consensus.app/papers/details/8a495ac898255b9789d5b570d44e287f/) — compact indices to full store [6]
- [Slipstream: Compaction Validation](https://consensus.app/papers/details/d9f740531198500790fa4446968ba4bf/) — +8.8pp accuracy [7]
- [All-Mem: Topology Memory](https://consensus.app/papers/details/cdf6707ce17c58c58b177f61ac36c24d/) — SPLIT/MERGE/UPDATE [8]
- [HCP: Hierarchical Context Pruning](https://consensus.app/papers/details/9635375ea36a567d8597f40085acb344/) — function-level pruning [9]
- [EMem: Event-Centric Memory](https://consensus.app/papers/details/53f4267a7a5b5d0b8dcef3cfd672fdd3/) — enriched discourse units [10]
- [TVCACHE: Tool Call Graph Caching](https://arxiv.org/abs/2602.10986) — 70% cache hit rate [11]

---

*Research compiled: 2026-07-06*
*Memory node: `research:context-quality-improvements-2026-07-06` (project scope)*
