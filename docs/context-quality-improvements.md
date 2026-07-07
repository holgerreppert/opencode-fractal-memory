# Comprehensive Research: Improving Context Quality for OpenCode

## Executive Summary

OpenCode generates context in 5 layers: base system prompt, project context files, conversation history, tool context, and auto-compaction [OpenCode Context Generation]. Our memory plugin adds 3 more layers: injected rules/reminders, retrieved memory nodes, and compressed tool outputs. This document synthesizes 15+ research papers, 8 competitor analyses, and our full codebase to identify the highest-impact improvements.

**Current context quality problems:**
1. **Forgetting after compaction**: The LLM subjectively decides what to keep when OpenCode compacts at 95% context window — important info is lost [Neural Memory Research]
2. **Blunt compression**: generic/truncate/git-quick categories average only 27% savings, accounting for 62% of all compressed output in conversation [Compression Stats]
3. **Flat retrieval**: Despite having BM25 + HNSW, injection still uses naive "take all L0 until budget exceeded" — no relevance scoring [Memory Improvement Research 2026-04-19]
4. **No structural awareness**: Code-specific compression (SWE-Pruner, LongCodeZip) shows that preserving AST structure and topological dependencies dramatically outperforms generic text compression [SWE-Pruner] [LongCodeZip]
5. **Agent-pull model creates retrieval friction**: Agent must decide when to search memory — often doesn't, leading to context starvation [Agent Pull Memory Model]

---

## 1. The Context Quality Problem Space

### 1.1 What "Context Quality" Means

Context quality has 4 dimensions, each independently improvable:

| Dimension | Definition | Current State | Target |
|-----------|-----------|---------------|--------|
| **Recall** | Relevant info is available when needed | ~78% (flat similarity) | ≥92% (scored retrieval) |
| **Precision** | Injected info is actually useful | Moderate (no gating) | High (gate + delta check) |
| **Density** | Useful tokens / total tokens in context | ~0.9× window (often overfilled) | ~0.6× window (budget-aware) |
| **Durability** | Info persists across compaction | Lossy (LLM decides) | Structured (indexed + retrievable) |

### 1.2 Literature Consensus (2024-2026)

**Coding agents are fundamentally different from document RAG:**
- "Standard RAG is poorly matched to agent memory" — bounded coherent interaction stream, not heterogeneous corpus [xMemory]
- Coding-agent memory (running code to gather evidence) dramatically outperforms RAG [LongMemEval-V2]
- Flat top-k similarity returns redundant context; summary hierarchies blur subtle distinctions [Agent Memory Consensus]

**Context pruning must be task-aware:**
- Generic compressors (LLMLingua) fail on code: they disrupt syntactic and logical structure [SWE-Pruner]
- LongCodeZip achieves 5.6× compression without degrading task performance by using code-aware conditional perplexity [LongCodeZip]
- SWE-Pruner's neural skimmer (0.6B params) dynamically selects relevant code lines given a task goal, achieving 23-54% token reduction while improving success rates [SWE-Pruner]

**Structured memory beats flat storage:**
- Knowledge graphs (AriGraph, PlugMem) outperform flat vector stores for complex reasoning [Coding Agent Memory Deep Dive]
- Multi-graph indexing (semantic + temporal + causal + entity) consistently beats single-view retrieval [Agent Memory Consensus]
- Event-centric memory (EMem) represents history as enriched elementary discourse units — matches or surpasses baselines with much shorter QA contexts [EMem]

**Proactive context management outperforms passive logging:**
- AgentFold: agents that actively "fold" sub-trajectories into summaries while preserving fine-grained details achieve 36.2% on BrowseComp, surpassing models 20× larger [AgentFold]
- Context-Folding: agents that procedurally branch, handle subtasks, then fold achieve 10× smaller active context while matching ReAct baselines [Context-Folding]
- Focus: agents that autonomously decide when to consolidate and prune achieve 22.7% token reduction with identical accuracy [Active Context Compression]

**Indexed experience memory is less lossy than summary-only:**
- Memex: maintains compact working context with stable indices, stores full-fidelity interactions in external database, agent learns when to dereference [Memex RL]
- Slipstream: validates compaction summaries against agent's continued reasoning, improving task accuracy by 8.8pp [Slipstream]

---

## 2. Our Current System: Strengths and Gaps

### 2.1 What We Already Have (Strengths)

| Feature | Status | Quality |
|---------|--------|---------|
| Hybrid retrieval (BM25 + HNSW) | ✅ Implemented | Good, but no relevance scoring on top-k |
| Injection gate (score thresholds) | ✅ Implemented | Good, per-type thresholds |
| Query refinement (LLM rewrite) | ✅ Implemented | Good, single-pass |
| MMR selection (diversity) | ✅ Implemented | Good, λ=0.5 |
| Command compression (7 strategies) | ✅ Implemented | Adequate for 80% of bash |
| Non-bash compression (read/glob/edit) | ✅ Implemented | Unique advantage |
| Reversible compression | ✅ Implemented | Comparable to squeez |
| Word abbreviations (45 entries) | ✅ Implemented | Unique |
| Output type detection | ✅ Implemented | New — covers build-log, dep-tree, log-stream |
| Ollama extraction (last-resort) | ✅ Implemented | Opt-in, verified extraction |
| File summarization (auto) | ✅ Implemented | Good coverage |
| Skeletonization (32 languages) | ✅ Implemented | Good |
| Working memory cache | ✅ Implemented | 8 nodes, 2h TTL |
| Auto-rate feedback | ✅ Implemented | Manual only |
| Fractal compression (L0→L2) | ✅ Implemented | Good |
| Session tracking | ✅ Implemented | Comprehensive |

### 2.2 Critical Gaps (Priority-Ordered)

#### Gap 1: No Task-Aware Code Compression (Highest Impact)

**Problem**: Our `generic.ts` and `truncate.ts` use blunt head+tail truncation or scoring-based relevance. Code has structure — function boundaries, import statements, class hierarchies — that generic compressors destroy.

**Evidence**:
- LongCodeZip: dual-stage code compression (function-level ranking → block-level selection) achieves 5.6× compression without degrading task performance [LongCodeZip]
- SWE-Pruner: task-aware neural skimmer preserves syntactic structure while achieving 23-54% token reduction [SWE-Pruner]
- Hierarchical Context Pruning (HCP): pruning function implementations in dependent files does not significantly reduce completion accuracy [HCP]

**Proposed Solution**: Add `compressCode()` to `output-types.ts`:
- Detect code output (file content, diff, tree)
- Extract structural skeleton (imports, class/func signatures, line numbers)
- Preserve error locations and line references
- Collapse function bodies to signatures when full content not needed

#### Gap 2: No Tool Call Deduplication (High Impact, Low Effort)

**Problem**: The agent repeats the same tool calls (e.g., `read` on the same file, `grep` with same pattern) across turns. Each repetition consumes tokens in context.

**Evidence**:
- DCP's `deduplicate()` strategy: groups by tool+args signature, keeps only most recent per group — removes stale duplicates from context [DCP Analysis]
- TVCACHE: prefix-tree environment-state-safe caching achieves 70% cache hit rate, 6.9× median speedup [TVCACHE]
- squeez: cross-call redundancy via exact hash + fuzzy trigram Jaccard ≥0.85 [Squeez]

**Proposed Solution**: Add `tool-dedup.ts` hook:
- `tool.execute.before`: compute signature hash of (tool + args), check LRU cache
- If match: serve cached output, mark `metadata.deduped`
- `tool.execute.after`: record output in cache (LRU eviction at 500 entries)
- Protected tools: `edit`, `write`, `task` (never dedup mutations)
- Turn protection: skip dedup for tools within N turns of current turn

#### Gap 3: No Error Input Pruning (High Impact, Low Effort)

**Problem**: Failed tool calls with verbose error inputs remain in context indefinitely, distracting the model.

**Evidence**:
- DCP's `purgeErrors()`: replaces ALL string input keys of errored tools after N turns with "[input pruned due to failed tool call]" [DCP Analysis]
- Focus agent: "distraction by irrelevant past errors" is a primary cause of reasoning degradation [Active Context Compression]

**Proposed Solution**: Add `error-prune.ts` hook:
- `chat.messages.transform`: iterate messages, find errored tool parts with status==="error"
- Check turn age ≥ threshold (default 4 turns)
- Check protected tools list
- Replace string values in `part.state.input` with "[input pruned after failed tool call]"

#### Gap 4: No Context-Limit Nudges (Medium Impact, Low Effort)

**Problem**: The model doesn't know when context is getting full and needs to be more concise.

**Evidence**:
- DCP's `injectCompressNudges()`: tracks per-model context limits, injects anchors at max, turn nudges at min, iteration nudges when many messages since last user message [DCP Analysis]
- Token-crunch: context window threshold (75% default) triggers auto-compaction nudge [Token-Crunch]

**Proposed Solution**: Extend `output-token-control.ts`:
- Add nudge mode: when pressure > 0.75, inject concise reminder
- Track per-model context limits
- Inject at 75% (reminder), 85% (strong reminder), 95% (compaction triggers)

#### Gap 5: No Session-Persistent Cache (Medium Impact, Medium Effort)

**Problem**: Our compression cache is in-memory only — lost between turns. Same outputs get re-compressed every turn.

**Evidence**:
- token-crunch: session-persistent JSON store at `~/.local/share/token-crunch/session-<id>.json` [Token-Crunch]
- squeez: session-long store for skill re-injection dedup [Squeez]

**Proposed Solution**: Add `session-cache.ts`:
- JSON store at `~/.config/opencode/scratch/session-<id>.json`
- Cache compression results keyed by output hash
- TTL: 1 hour default, configurable
- Load on hook init, save on exit

#### Gap 6: No Fuzzy Deduplication (Medium Impact, Low Effort)

**Problem**: Exact match dedup misses near-duplicate outputs (e.g., `ls` before/after file creation).

**Evidence**:
- squeez: fuzzy trigram Jaccard ≥0.85 catches near-duplicates [Squeez]
- CCE: line-level Jaccard ≥0.85, fingerprint via first 5 normalized lines [CCE]
- token-crunch: LCS ratio ≥85% near-match → unified diff output [Token-Crunch]

**Proposed Solution**: Add `fuzzy-dedup.ts`:
- Trigram shingle generation + Jaccard similarity
- Threshold: 0.85
- If near-duplicate: emit unified diff instead of full content
- Fallback: exact match (existing)

#### Gap 7: No Structural Shape Detection for More Formats (Medium Impact, Low Effort)

**Problem**: We detect JSON, CSV, stack traces, trees, tables. But miss: NDJSON/JSONL, YAML/TOML, compiler diagnostics, coverage logs, markup, test output.

**Evidence**:
- token-crunch: 14 detected shapes with per-shape collapse rules [Token-Crunch]
- tokf: 63 built-in TOML filter patterns for common CLI commands [Tokf]

**Proposed Solution**: Extend `shape.ts`:
- Add: `compiler-diagnostics` (group by file, show errors/warnings only)
- Add: `coverage-log` (collapse per-file coverage to summary)
- Add: `test-output` (group by file, show PASS/FAIL per file)
- Add: `npm-install` (collapse dependency chains)

#### Gap 8: No Structured Episodic Store (Medium Impact, High Effort)

**Problem**: We have `agent_tool_calls` table but no memory ops consume it. Episodes (user messages, tool calls, agent responses) are lost after compaction.

**Evidence**:
- EMem: event-centric memory represents history as enriched elementary discourse units — self-contained statements with normalized entities and source turn attributions [EMem]
- All-Mem: explicit, non-destructive consolidation with SPLIT/MERGE/UPDATE operators preserves immutable evidence [All-Mem]

**Proposed Solution**: Add `episodic-store.ts`:
- New `episodes` table: user_msg, tool_call, agent_response, outcome
- Hooks record every significant event
- Session-idle promotion: significant episodes → semantic memory nodes
- Auto-purge after configurable TTL (default 7 days)

#### Gap 9: No Conflict Detection + Dedup on Write (Medium Impact, Medium Effort)

**Problem**: Same fact stored N times, BM25 over-weights it. Contradictory facts coexist.

**Evidence**:
- Memory Efficiency Research: "No dedup causes frequency-weighted noise" [Memory Efficiency Research]
- AdaMem: adaptive user-centric memory with conflict resolution [Coding Agent Memory Deep Dive]

**Proposed Solution**: Add `conflict-detection.ts`:
- On `memory_set`: HNSW search for similar nodes (threshold 0.85)
- Dedup: skip creation if near-duplicate found
- Conflict: flag contradictory facts to agent with ADD/UPDATE/DELETE/SKIP/MERGE choices

#### Gap 10: No Per-Node TTL (Low Impact, Low Effort)

**Problem**: Stale high-importance memories dominate retrieval indefinitely.

**Evidence**:
- Memory Efficiency Research: "Stale memory poisoning: old high-importance memories dominate retrieval" [Memory Efficiency Research]
- MSSR: memory-aware replay based on Ebbinghaus forgetting curve [Coding Agent Memory Deep Dive]

**Proposed Solution**: Add `ttl_days` column to `memory_nodes`:
- Expired nodes excluded from search unless `--include-expired` flag
- Configurable `default_ttl_days` per store
- `sticky + TTL`: excluded from search but not deleted

---

## 3. Implementation Priority Matrix

| Priority | Gap | Impact | Effort | Eff/Impact |
|----------|-----|--------|--------|------------|
| **P0** | #1 Task-aware code compression | High | Medium | 2.0 |
| **P1** | #2 Tool call deduplication | High | Low | 0.5 |
| **P1** | #3 Error input pruning | High | Low | 0.5 |
| **P2** | #4 Context-limit nudges | Medium | Low | 0.5 |
| **P2** | #6 Fuzzy deduplication | Medium | Low | 0.5 |
| **P2** | #7 Structural shape detection | Medium | Low | 0.5 |
| **P3** | #5 Session-persistent cache | Medium | Medium | 1.0 |
| **P3** | #8 Structured episodic store | Medium | High | 2.0 |
| **P3** | #9 Conflict detection + dedup | Medium | Medium | 1.0 |
| **P4** | #10 Per-node TTL | Low | Low | 0.3 |

---

## 4. Architecture Recommendations

### 4.1 Hook-Level Changes

**New hooks to add to `src/plugin/hooks.ts`:**

```typescript
// P1: Tool deduplication
tool.execute.before   → toolDedupHandler (check cache, serve cached output)
tool.execute.after    → toolDedupHandler (record output in cache)

// P1: Error pruning
chat.messages.transform → errorPruneHandler (prune stale errored tool inputs)

// P2: Context nudges (extend existing output-token-control)
system.transform      → outputTokenControl (add nudge mode)

// P2: Code compression (extend existing compression)
tool.execute.after    → compressionHandler (add compressCode path)

// P3: Episodic store
tool.execute.before   → episodicRecordHandler (record tool calls as episodes)
tool.execute.after    → episodicRecordHandler
```

### 4.2 New Application Modules

```
src/application/
├── tool-dedup.ts          # P1: createSignature, checkDedup, recordOutput, LRU
├── error-prune.ts         # P1: createErrorPruneHandler
├── session-cache.ts       # P3: JSON store, TTL, load/save
├── fuzzy-dedup.ts         # P2: trigram shingles, Jaccard similarity
├── conflict-detect.ts     # P3: HNSW similarity search, conflict resolution
├── episodic-store.ts      # P3: episodes table, session-idle promotion
└── context-nudges.ts      # P2: extend adaptive-pressure with nudge levels
```

### 4.3 Config Schema Additions

```typescript
// src/infrastructure/config/config.ts
interface MemConfig {
  // ... existing fields ...
  
  toolDedup: {
    enabled: boolean;
    maxCacheEntries: number;
    protectedTools: string[];
    turnProtectionTurns: number;
  };
  
  errorPruning: {
    enabled: boolean;
    turns: number;
    protectedTools: string[];
  };
  
  contextNudges: {
    enabled: boolean;
    nudgeThreshold: number;
    strongNudgeThreshold: number;
  };
  
  fuzzyDedup: {
    enabled: boolean;
    threshold: number;
    shingleSize: number;
  };
  
  sessionCache: {
    enabled: boolean;
    ttlHours: number;
    path: string;
  };
  
  episodicStore: {
    enabled: boolean;
    autoPromoteThreshold: number;
    purgeTtlDays: number;
  };
  
  nodeTtl: {
    enabled: boolean;
    defaultTtlDays: number;
  };
}
```

---

## 5. Expected Outcomes

| Metric | Current | After P0-P2 | After P3-P4 |
|--------|---------|-------------|-------------|
| Token usage per turn | ~0.9× window | ~0.6× window | ~0.5× window |
| Recall accuracy | ~78% | ~85% | ~92% |
| Dedup savings | 0% | 15-20% | 15-20% |
| Error input waste | Unbounded | Pruned after 4 turns | Pruned after 2 turns |
| Compression on code | ~27% | ~60% (code-aware) | ~60% |
| Stale memory noise | High | Reduced (TTL) | Reduced (conflict detection) |

---

## 6. References

### OpenCode Context Generation
[How OpenCode Generates Context](../docs/opencode-context-generation.md) — 5-layer context model

### Research Papers
- [SWE-Pruner: Self-Adaptive Context Pruning for Coding Agents](https://consensus.app/papers/details/9e67e77ffc1151a7a77adf142767529c/) — task-aware neural skimmer, 23-54% token reduction [1]
- [LongCodeZip: Compress Long Context for Code Language Models](https://consensus.app/papers/details/8385398b075c5035998dd6b66649dc31/) — dual-stage code compression, 5.6× ratio [2]
- [Hierarchical Context Pruning](https://consensus.app/papers/details/9635375ea36a567d8597f40085acb344/) — function-level pruning, preserves topological dependencies [3]
- [AgentFold: Long-Horizon Web Agents with Proactive Context Management](https://consensus.app/papers/details/a90926f6664152449b442daf23b778ca/) — proactive folding, 36.2% BrowseComp [4]
- [Scaling Long-Horizon LLM Agent via Context-Folding](https://consensus.app/papers/details/64c6090637c756e6a5e29e59f6e22739/) — 10× smaller active context [5]
- [Active Context Compression: Focus Agent](https://consensus.app/papers/details/98427599d6a1595fa861bf35f33eb87b/) — autonomous compression, 22.7% token reduction [6]
- [Memex(RL): Indexed Experience Memory](https://consensus.app/papers/details/8a495ac898255b9789d5b570d44e287f/) — indexed memory, less lossy than summary-only [7]
- [Slipstream: Trajectory-Grounded Compaction Validation](https://consensus.app/papers/details/d9f740531198500790fa4446968ba4bf/) — validates compaction, +8.8pp accuracy [8]
- [xMemory: Beyond RAG for Agent Memory](https://consensus.app/papers/details/ff5f689844445b358a144a568c944995/) — decoupling before aggregation [9]
- [LongMemEval-V2](https://consensus.app/papers/details/2a0405ed67975036bef7839c4d43396a/) — coding-agent memory 72.5% vs RAG 48.5% [10]
- [EMem: Event-Centric Conversational Memory](https://consensus.app/papers/details/53f4267a7a5b5d0b8dcef3cfd672fdd3/) — enriched discourse units [11]
- [All-Mem: Dynamic Topology Evolution](https://consensus.app/papers/details/cdf6707ce17c58c58b177f61ac36c24d/) — SPLIT/MERGE/UPDATE operators [12]
- [TVCACHE: Tool Call Graph Caching](https://arxiv.org/abs/2602.10986) — 70% cache hit rate, 6.9× speedup [13]
- [Squeez: ML-Based Tool Output Pruning](https://arxiv.org/abs/2604.04979) — 92% compression, 0.80 F1 [14]
- [ARCS: Agentic Retrieval-Augmented Code Synthesis](https://consensus.app/papers/details/51b4d7b375fa51668feb27e163dd93c0/) — retrieval-before-generation, 87.2% HumanEval [15]
- [Coding Agents are Effective Long-Context Processors](https://consensus.app/papers/details/1d7f765a637e51a99b0f1353b95304ee/) — file system navigation outperforms semantic search [16]
- [Context-Augmented Code Generation: 49% Decision Compliance](https://consensus.app/papers/details/5e99cae3dcad582eb66c6833fa5b8f57/) — product context retrieval 95% vs 46% compliance [17]
- [Dynamic Context Selection for RAG](https://consensus.app/papers/details/c6aafb2e22085352bb3febb1b47fefd1/) — context-size classifier, mitigates distractors [18]
- [Memory for Autonomous LLM Agents: Survey](https://consensus.app/papers/details/c39606478b3c5d80b1d7ed3513145b45/) — write-manage-read loop taxonomy [19]

### Our Research Nodes (Project Scope)
- DCP Analysis: [research:dcp-analysis-hook-comparison](memory://global/research:dcp-analysis-hook-comparison)
- Neural Memory: [research:neural-memory-approaches-2026-06-17](memory://global/research:neural-memory-approaches-2026-06-17)
- Coding Agent Memory: [research:coding-agent-memory-deep-dive-2026-06-16](memory://global/research:coding-agent-memory-deep-dive-2026-06-16)
- Memory Injection: [research:memory-injection-improvements-2026-04-17](memory://global/research:memory-injection-improvements-2026-04-17)
- Memory Efficiency: [memory-efficiency-research-findings](memory://global/memory-efficiency-research-findings)
- Agent Memory Consensus: [research:agent-memory-consensus-2026](memory://global/research:agent-memory-consensus-2026)
- Tool Compression Landscape: [research:tool-output-compression-landscape-2026](memory://global/research:tool-output-compression-landscape-2026)
- Tool Compression Gap: [research:tool-compression-gap-analysis](memory://global/research:tool-compression-gap-analysis)
- Memory Improvement 2026-04-19: [memory-improvement-research-2026-04-19](memory://global/memory-improvement-research-2026-04-19)
- Injection Improvements Findings: [memory-injection-improvements-findings-2026-04-19](memory://global/memory-injection-improvements-findings-2026-04-19)
- Architectural Review: [architectural-review-plan](memory://global/architectural-review-plan)
- Context Engineering Skill: [skill:context-engineering](memory://global/skill:context-engineering)
- Agent Pull Model: [rule:mandatory:agent-pull](memory://global/rule:mandatory:agent-pull)

---

## 7. Next Steps

### Immediate (This Week)
1. **P1: Tool call deduplication** — `src/application/tool-dedup.ts` + hook wiring
2. **P1: Error input pruning** — `src/plugin/hooks/error-prune.ts`
3. **P2: Context-limit nudges** — extend `output-token-control.ts`

### Short Term (2-3 Weeks)
4. **P0: Task-aware code compression** — `compressCode()` in `output-types.ts`
5. **P2: Fuzzy deduplication** — `src/application/fuzzy-dedup.ts`
6. **P2: Structural shape detection** — extend `shape.ts` with compiler-diagnostics, coverage-log, test-output

### Medium Term (1-2 Months)
7. **P3: Session-persistent cache** — `src/application/session-cache.ts`
8. **P3: Conflict detection** — `src/application/conflict-detect.ts`
9. **P3: Episodic store** — `src/application/episodic-store.ts`
10. **P4: Per-node TTL** — schema migration + search filter

---

*Research compiled: 2026-07-06*
*Sources: 15+ research papers, 8 competitor analyses, full codebase audit*