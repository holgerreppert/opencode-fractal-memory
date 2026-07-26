# Organizing Memory for a Coding Agent

A “coding agent memory” should be organized around **(1) what to remember**, **(2) how long to keep it**, and **(3) how to retrieve it reliably**. A human-brain-inspired design can be useful conceptually, but you typically want **explicit, tool-friendly structures** (indexes, schemas, pointers to code locations) rather than a direct human analogy.

---

## 1) The 4 Memory Layers

### A) Working Memory (ephemeral, per task)
Used only during the current coding session. Keep it small and discardable:
- current repo context (few bullets)
- current hypothesis (e.g., “bug is caused by X”)
- constraints (performance, style, backward compatibility)
- plan + next actions
- open questions
- patches being tested

**Goal:** correctness and continuity within a single task.

---

### B) Short-term Episodic Memory (recent sessions/tasks)
Stores “what happened” so the agent doesn’t repeat itself and can learn from outcomes:
- recent errors and stack traces
- commands tried and results
- refactors attempted and why they were reverted
- decisions made (“we chose B because A caused CI to fail”)

**Goal:** avoid thrashing; provide continuity across nearby work.

**Tip:** keep for days/weeks (or until “no longer relevant”).

---

### C) Long-term Curated Memory (stable knowledge)
Store things that are likely to remain valid:
- project architecture summary (modules, boundaries, ownership)
- coding conventions and tooling rules (lint/test/build commands)
- “source of truth” pointers (where config lives, how CI runs)
- stable domain knowledge learned from the codebase
- reusable patterns that *actually worked*

**Goal:** build institutional knowledge that improves future tasks.

---

### D) Retrieval Index (the real engine)
Memory without retrieval is useless. Use retrieval structures that support different query types:
- **Semantic/vector search** for “find similar past fixes / issues / code patterns”
- **Keyword/inverted index** for exact matches (file names, symbols, identifiers)
- **Structured tags**: `{language, framework, component, file_path, subsystem}`
- Optional but powerful: **dependency graph links**
  - e.g., “function → callers” and “module → imports”

**Goal:** retrieve by *intent* fast and accurately.

---

## 2) Would a Human-Brain Approach Be Good?

### What “brain-like” ideas get right
- **Episodic memory:** remember experiences (attempts + outcomes)
- **Consolidation:** promote only high-signal knowledge into long-term memory
- **Attention:** focus on the most relevant past episodes for the current task

### What to avoid
Human memory doesn’t give reliable **symbol-level retrieval** (exact functions/files/lines).
For coding, you want:
- explicit references to the repo (file paths, symbol names, commit hashes)
- evidence-backed claims (what tests passed, what commands succeeded)
- deterministic pointers where possible

**Conclusion:** use *brain-inspired principles* (episodic → consolidated, attention → retrieval), but implement with **schemas + indexes + promotion rules**.

---

## 3) A Concrete Memory Pipeline (Actionable)

### Step 1: Capture Events During Work
Automatically log high-signal events:
- test failures (error text + related test command)
- diffs/patches and outcomes (pass/fail, metrics if any)
- commands tried and results
- decisions and rationale (“why we changed X”)

---

### Step 2: Summarize Episodes in a Structured Way
Instead of storing raw logs forever, store a short summary:
- concise episode summary (5–20 lines)
- tags (subsystem, keywords)
- related files/paths
- outcome and reason categories

---

### Step 3: Promote Only High-Signal Knowledge
Move content into long-term memory only if it meets criteria like:
- it solves the problem reliably
- it prevents known failure modes
- it describes a repeatable procedure or invariant

Examples:
- “How to run local DB migrations for this repo”
- “Known workaround: X”
- “Invariant: keep Y in sync with Z”
- “Pattern that worked for bug class Q”

---

### Step 4: Link Memory to Source of Truth
Long-term memory should include pointers for verification:
- file paths and symbols
- relevant config locations
- commit hash(s) or release tags (if available)
- test names or CI pipeline steps used to validate

**Rule:** memory is actionable only if it can be checked in the repo.

---

### Step 5: Decay/Forget Low-Signal Content
Aggressively reduce retention for:
- one-off errors without a stable cause
- vague suggestions (“we should refactor”) without evidence
- large noisy logs not tied to a decision

---

## 4) Minimal Schemas That Work

Start small. Just 3 entity types:

### A) Episode
Stores “what happened”:
```json
{
  "timestamp": "...",
  "task\_id": "...",
  "problem": "...",
  "attempts": ["..."],
  "errors": ["..."],
  "result": "pass|fail",
  "related\_files": ["path/to/file1", "path/to/file2"],
  "tags": ["subsystem", "language", "framework"]
}