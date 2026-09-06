export interface SeedNode {
  label: string;
  tag: string | null;
  content: string;
  summary?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export const SEED_NODES: SeedNode[] = [
  // Rule nodes (auto-injected)
  {
    label: "rule:mandatory:memory",
    tag: "rule:mandatory",
content: `## Memory Tool Mandatory Rules
tag: rule:mandatory

Memory search costs ~100x less than reading files cold. ALWAYS search before reading.

### Rules
- Search before get — get only verified labels
- Memory first: memory(mode="search") costs 100x less than grep/read
- Graph before edit: graph(callers) costs 10-100x less than grep
- Replace needs re-read first (content can change)
- Edit: read file first | write for new files
- Error -> store as error node | Solved -> mark + add to rules
- **On every write/update: provide \`summary\` (1-2 lines, 150-220 chars) + \`keywords\` (5-10 comma tokens) — separate DB field \`keywords\` BM25-indexed ×2 weight for hub network lexical search (auto-generated if omitted but explicit preferred)**

### Auto-Learned
- Review tool arguments and ensure correct format
- Avoid memory(mode="drilldown") with vague queries — use memory(mode="search") first
- Re-read file before replace to ensure content is current
- Verify node exists before memory(mode="delete")
- Use ripgrep (rg) for direct code search instead of slow tools with timeouts`,
  },
  {
    label: "rule:standard",
    tag: "rule:standard",
    content: `## Memory Tool Standard Rules
tag: rule:standard

### Workflow
- Search before get — set chain: search → drilldown/get → set/verify/replace
- Verify after confirming something works — builds confidence over time
- Store every significant tool result — it costs almost nothing and prevents re-discovery`,
  },
  {
    label: "rule:suggestion",
    tag: "rule:suggestion",
    content: `## Memory Tool Suggestions
tag: rule:suggestion

### Optimization
- llm_compress before compressing — preserves important context better than extractive
- extract_patterns quarterly — find cross-node patterns you'd miss manually
- higher bm25 (0.6-0.8) for exact searches | lower (0.2-0.4) for semantic discovery
- Use context(mode="inject") for automatic memory injection — relieves manual search`,
  },
  {
    label: "rule:mandatory:core",
    tag: "rule:mandatory",
    content: `## Behavioral Rules Injection System
tag: rule:mandatory

### How to Use This System
When you discover an error or better approach:
1. Distill the correct usage pattern
2. Add it to the appropriate rules node
3. The rule gets injected next cycle

### 3 Tag Levels
- rule:mandatory - Always injected, always enforced
- rule:standard - Injected, suggested
- rule:suggestion - Injected, optional`,
  },
  {
    label: "rule:mandatory:agent-pull",
    tag: "rule:mandatory",
    content: `## Agent MUST Use Memory & Graph
tag: rule:mandatory
never_strip: true

### BEFORE any non-trivial task (3+ steps), you MUST call memory(mode="search")
- Working on a file/module you've worked on before? → memory(mode="search", query="<topic>")
- User asks about past decisions? → memory(mode="search", query="<topic>")
- Not sure about a convention? → memory(mode="search", query="<topic>")
- Seeing errors you've seen before? → memory(mode="search", query="<topic>")

### BEFORE editing, you MUST use graph(relation="callers", name="<fn>")
- Check what depends on the function you're changing
- Use graph(relation="dependents", file="<path>") for file-level impact
- Use graph(relation="search", query="<name>") INSTEAD of grep for symbols

### How to Search Memory
1. Call memory(mode="search") with concise keywords — NOT the raw user message
2. Strip system reminders, logs, and code noise from your query
3. Extract the core intent: what do you actually need to know?
4. Check results — if >50% match, use memory(mode="drilldown") for details
5. Reference memory in your response with file:line format

### Memory Categories (Episodic vs Semantic)
- **Semantic** (persists long-term): concept, fact, lesson, howto, preference, decision, architecture, best-practices, convention, knowledge, research, rule:*, skill, playbook, core, summary, bug, fix
- **Episodic** (short-term, 7d half-life): event, note, session, task, plan, exploration, debug-investigation, improvement, review

### Decision Flow
User request → MUST check memory → MUST check graph if editing → Verify codebase → Act
Only skip memory search for trivial tasks (<2 steps)`,
  },
  {
    label: "rule:mandatory:tools",
    tag: "rule:mandatory",
    content: `## Tool-Specific Behavioral Rules
tag: rule:mandatory
never_strip: true

### DECISION TREE (ALWAYS FOLLOW — ordered by priority)
1. BEFORE grep/glob/read → graph(search, query=...) first (10-100× more token-efficient)
2. BEFORE editing a function → graph(callers, name=...) to check dependents first
3. BEFORE complex tasks (3+ steps) → context(check) to check context pressure
4. BEFORE reading any file → memory(mode="search", query="first") (100× cheaper than reading blind)
5. AFTER finding a symbol → graph(callees, name=...) to trace what it calls
6. AFTER tool results → memory(mode="set") to store what was learned
7. END of session → learn(reflect) → learn(distill) to extract rules

### graph (BEFORE all edit/read operations)
- BEFORE editing any function: graph(relation="callers", name="<fn>")
- BEFORE grep/glob for a symbol: graph(relation="search", query="<name>")
- BEFORE changing a file: graph(relation="dependents", file="<path>")
- AFTER finding a symbol: graph(relation="callees", name="<fn>")
- To trace transitive deps: graph(relation="call_chain", name="<fn>", depth=3)

### edit tool
- ALWAYS read file first with read tool
- NEVER edit non-existent files - use write for new files
- Provide exact oldString (copy from read output)
- ALWAYS check graph callers BEFORE editing

### write tool
- ALWAYS verify file doesn't exist first
- NEVER write to existing files without reading them

### bash tool
- ALWAYS quote paths with spaces
- NEVER use destructive commands without explicit user request
- NEVER skip hooks (--no-verify, --no-gpg-sign)
- For code exploration, prefer grep/glob/graph tools over shell commands
- NEVER use bash + sqlite3 for memory node CRUD (search/get/set/delete/list/drilldown) — use the memory tool. Bash triggers output compression → scratch file stash → pipe tangles. Memory tool is purpose-built and avoids all overhead.
- BEFORE reaching for any generic bash command, ask: "Is there a purpose-built consolidated tool (memory/graph/context/learn/journal) for this?" If yes, use that instead.

### memory (consolidated tool) + 4 verb aliases memory_search/fetch/get/set (prefer aliases for clarity — fewer tokens short but more tokens is OK per plan, clarity > brevity)
- USE memory(mode="search") or memory_search(query="concise keywords") FIRST BEFORE any get/drilldown — search is 100× cheaper than read/grep. NEVER drilldown with vague queries — search first with concise keywords (not raw user message). Example: search="auth JWT verification" not "what did we do about JWT?". Ex: memory_search(query="auth flow", limit=5)
- AFTER search, then use memory_get(id="uuid from search") or memory(mode="get", id="...") OR memory_fetch(label="fact:exact-label") for known labels (fact:, rule:, dot:, lesson:). Both get/fetch accept id OR label; fetch/drilldown prefer label. Use drilldown after search when relevance >50% for full fractal source chain.
- BEFORE memory(mode="replace") MUST re-read with memory_get/memory(mode="get") first to ensure current content — provide oldText + newText.
- USE memory_search/memory(mode="search") BEFORE every edit/bash/write to find relevant context — saves retracing. AFTER significant tool result → memory_set(label="fact:...", content="what+why", type="fact", summary="1-2 line summary", keywords="comma, keywords, for, BM25") and verify with learn(mode=verify). **Every set MUST include \`summary\`+\`keywords\` (BM25 ×2, hub network) — auto-generated if omitted.**
- ALIASES (distinct tools, same handlers, Anthropic namespacing):
  - memory_search(query, limit, tagsFilter) — alias for mode="search" — USE WHEN you need context BEFORE answering.
  - memory_fetch(label) — alias for mode="fetch" — USE WHEN you know exact label.
  - memory_get(id|label) — alias for mode="get" — USE WHEN you have UUID from search/list.
  - memory_set(label, content, type, summary, keywords) — alias for mode="set" — USE WHEN storing new knowledge (semantic 365d: fact/lesson/concept/decision/knowledge vs episodic 7d: event/note/session). \`summary\`+\`keywords\` are mandatory BM25 fields (keywords ×2). Verify after with learn(mode=verify).
- See also: graph(relation="search", query="Symbol") for code, context(mode="check") for pressure, learn(mode="verify") after set.

### context (consolidated tool)
- USE context(mode="check") at start of complex tasks (>3 steps)
- If >60% pressure: context(mode="compress") OR context(mode="llm_compress")
- After compaction: use context(mode="recall") to recover state
- Use context(mode="inject") for automatic memory injection

### learn (consolidated tool)
- USE learn(mode="reflect") after session ends to learn from mistakes
- USE learn(mode="verify") after storing important information
- USE learn(mode="dashboard") weekly for system health

### journal (consolidated tool)
- USE journal(mode="write") after completing significant tasks to capture decisions

### project_hub (dedicated fine-grained network — USE FOR CRYSTAL-CLEAR PROJECT STRUCTURE KNOWLEDGE)
- **ALWAYS use project_hub for crystal-clear knowledge about project structure** — architectural decisions, layer maps, common mistakes & exact solutions, conventions. This is a **fine-grained, positioned network** (\`hub --parent_ids--> arch:* --parent_ids--> lesson/fix\`) — **finding the right position is central**. A Svelte brain lesson belongs under \`arch:svelte-frontend\`, not hub root; a BM25 bug belongs under \`arch:storage-and-query-layers\`. Wrong position = not found.
- **Before set: search + network to find correct parent** — \`project_hub(mode="search", query="topic")\` + \`project_hub(mode="network")\` to see hub map, pick **most specific parent** (e.g. \`arch:svelte-frontend\` for Three/Skeleton), include it in \`parent_ids\` (hub root always included). If no parent exists, create \`arch:new-area\` first.
- Modes: \`project_hub(mode="search", query="topic")\` BEFORE any structural question; \`project_hub(mode="set", label="decision:...", content="crystal-clear what+why with file:line", type="decision", summary="1-2 line crystal summary", keywords="...", parent_ids="arch:specific-parent,fact:opencode-fractal-memory-hub")\`; \`project_hub(mode="network")\` for positioned digest.
- Every set is **positioned, crystal-clear, verified** (summary 1-2 lines, keywords 5-10, file:line tags, parent_ids to correct parent); hub is sticky, network is browsable via network + dot:hub-network.
  `,
  },
  {
    label: "rule:mandatory:project-hub",
    tag: "rule:mandatory",
    content: `Project Hub — Crystal-Clear Network for Project Structure Knowledge
tag: rule:mandatory
never_strip: true

This is the dedicated tool for **crystal-clear knowledge about project structure** — architectural decisions, **how the project is structured (layers, where things live)**, common mistakes & exact solutions, conventions — as a **fine-grained, positioned network** (hub --parent_ids--> arch:* --parent_ids--> lesson/fix), not a flat list or episodic memory. **Finding the right position in the network is central — it must be in a good position.**

### Crystal-clear, positioned, not fuzzy
- Each node must be **crystal-clear**: precise, verified, file:line, no vague prose. Hub = project structure router; children = fine-grained leaves.
- **Position is key**: The network is **fine-grained**. A new node belongs under its **most specific parent**, not hub root. Example: Svelte brain-smoothing lesson → \`arch:svelte-frontend\` (not hub); BM25 keywords bug → \`arch:storage-and-query-layers\`; TUI registration → \`decision:tui-global-tuijson-registration\`. Wrong position = invisible, even with perfect keywords.
- Before any set: **MUST** run \`project_hub(mode="search", query="<topic>")\` + \`project_hub(mode="network")\` to see the map and pick the correct parent. If no specific parent exists, create it first (\`arch:new-area\` under hub), then place your node under it.

### When to use project_hub vs memory
- Project structure discovery, architectural decision / rationale / convention / bug root cause+exact fix / anti-pattern → \`project_hub(mode="set", label="decision:...", type="decision", summary="crystal summary", keywords="...", parent_ids="arch:specific-parent,fact:opencode-fractal-memory-hub")\`
- Episode / log / session trace → \`memory(mode="set", type="event")\`
- Question about structure/decision/error → \`project_hub(mode="search", query="topic")\` FIRST, then drilldown — 100× cheaper than codebase grep

### Mandatory fields for every hub node (positioned, crystal-clear)
- \`label\` kebab: \`arch:\`/\`fact:\`/\`decision:\`/\`lesson:\`/\`fix:\`/\`convention:\`/\`knowledge:\` (e.g. \`fix:bm25-keywords-weight\`)
- \`content\` crystal-clear what+why with verification \`file:src/...:line\` + \`keywords\` + \`summary\`
- \`type\` in hub types [fact,decision,lesson,fix,convention,architecture,knowledge,skill,playbook,dot,workflow,concept,research]
- \`summary\` 1-2 lines 150-220 chars, crystal-clear (BM25 1×)
- \`keywords\` 5-10 comma tokens e.g. \`svelte,skeleton,AppShell,GLBLoader,laplacianSmooth\` — must include parent area terms for positioning (BM25 ×2 hub network vectors, separate DB field)
- \`parent_ids\` **CRITICAL**: comma list to **correct position** (most specific parent + hub root), e.g. \`arch:svelte-frontend,fact:opencode-fractal-memory-hub\` — auto-adds hub root if omitted but specific parent is mandatory for fine-grained placement

### Network (find correct position)
- \`project_hub(mode="network")\` → hub + positioned children (hub --parent_ids--> arch:* --parent_ids--> leaves), capped 1.5KB — use to choose parent before set.
- \`project_hub(mode="search", query="topic")\` → hub network only (hub types, parent_ids-boosted, summary+keywords lexical).
- DOT: \`dot:hub-network\` auto-generated from parent_ids for Visualize tab (see arch:svelte-frontend brain viz).
- Label \`dot:hub-network\` is sticky via viz.js; hub is sticky and never compressed. Keep hub lean: 1-2 line crystal summaries, 5-10 keywords, file:line tags, correct parent.
`,
  },
  // Storage curation rule
  {
    label: "rule:mandatory:what-to-store",
    tag: "rule:mandatory",
    content: `What to Store in Memory — and Why
tag: rule:mandatory
never_strip: true

### HIGH VALUE — Store These
Every node should make future-you smarter or faster. Decision framework: "Will this help me avoid a mistake, make a better choice, or save time next session?"

1. Architecture decisions + rationale
   → "We chose SQLite over Postgres because zero-provisioning for local dev"
   → WHY it matters: Prevents re-litigation, preserves context for new contributors

2. Bug root causes + fix patterns
   → "Error X at line Y means Z config is missing. Fix: add W to package.json"
   → WHY it matters: Next occurrence is 10× faster to fix

3. Project conventions
   → "All API routes use kebab-case, error responses use {error, code} shape"
   → WHY it matters: AI output matches project style without correction

4. User preferences
   → "User prefers bullet-point summaries, not paragraphs"
   → WHY it matters: Personalizes output, reduces friction

5. Config workarounds and gotchas
   → "Package X v3 needs --legacy-peer-deps or it fails with error Y"
   → WHY it matters: Saves future debugging hours

6. Anti-patterns and dead ends
   → "We tried approach X in PR #42. It failed because Y. Don't repeat."
   → WHY it matters: Learns from past mistakes

7. Dependency relationships
   → "Service A depends on module B, which requires config C"
   → WHY it matters: Prevents breaking changes from unaware edits

8. Session summaries
   → "Session 2026-07-12: Implemented X. Next: Y. Decision: Z."
   → WHY it matters: Continuity across sessions, context recovery after compaction

### LOW VALUE — Skip These
Why they hurt: waste token budget, bury relevant results, degrade retrieval precision

1. Code content (function bodies, class implementations)
   → Already in source files — code IS the source of truth, don't duplicate it
   → Exception: store the file's purpose, not its content (e.g. "file:src/foo.ts → validation utilities")

2. Verbose logs / command output
   → Transient, token-expensive, nearly zero reuse value
   → Exception: a specific error signature with fix

3. Ephemeral conversation details
   → "User asked about X then changed their mind" — decays fast, low reuse

4. Information already in seed rules
   → Duplicate rules waste injection budget. Check ruleCache first.

5. Transient state
   → Cursor position, temp variable values, one-time debugging breadcrumbs

### Category Assignment
- Semantic type (365d half-life): concept, fact, lesson, howto, preference, decision, architecture, best-practices, convention, knowledge, rule:*, bug, fix
  → USE for permanent knowledge that should persist indefinitely
- Episodic type (7d half-life, 30d TTL): event, note, session, task, plan, exploration, debug-investigation, improvement, review
  → USE for session-scoped traces that decay automatically

### Quick Decision Tree
Will this help future-you? → YES → Is it already in a file? → NO → Store (semantic if permanent, episodic if session-scoped)
Will this help future-you? → YES → Is it already in a file? → YES → Store only as a summary/reference, not the full content
Will this help future-you? → NO → Skip it

### Mandatory Summary + Keywords (BM25 hub network)
Every \`memory_set\`/\`memory(mode="set")\` MUST include:
- \`summary\`: 1-2 line short summary (150-220 chars) — BM25-indexed 1× for lexical search
- \`keywords\`: 5-10 comma-separated short tokens (e.g. \`svelte,skeleton,AppShell,brain,GLBLoader\`) — separate DB field \`memory_nodes.keywords\` BM25-indexed ×2 weight for hub network vectors (content network + semantic embedding). Auto-generated via TF fallback if omitted, but explicit is preferred and better for search. This powers the project hub network: hub aggregates child \`summary\` via \`parent_ids\` vectors, keywords enable precise lexical lookup beyond embeddings.`,
  },
  // Feature info nodes (auto-injected as info reminders)
  {
    label: "rule:feature:command-compression",
    tag: "rule:feature",
    content: `Command Compression Feature
tag: rule:feature

Bash command output may be compressed via one of 7 strategies (ls, test, grep, git-status, git-log, git-diff, git-quick, truncate, generic). The first line shows the compression strategy and savings. Original output is preserved on non-zero exit. View stats at management app → Compress tab.`,
  },
  {
    label: "rule:feature:auto-retrieve",
    tag: "rule:feature",
    content: `Auto-Retrieve Feature
tag: rule:feature

Memory search results may be reordered by an LLM judge or fallback scorer based on your current reasoning context. Results show a '## Reranked Memory Results' header with relevance percentages per node. Higher relevance = better match for your current task.`,
  },
  {
    label: "rule:feature:tag-intersection-search",
    tag: "rule:feature",
    content: `Tag Intersection Search Feature
tag: rule:feature

Memory search accepts a \`tagsFilter\` option — returns only nodes containing ALL specified tags (intersection semantics). Empty array = no filter. Use when narrowing search results to nodes with specific tags.`,
  },
  {
    label: "rule:feature:source-propagation",
    tag: "rule:feature",
    content: `Source Propagation Feature
tag: rule:feature

All memory nodes have a \`source\` field set on creation. Values: \`manual\` (user memory(mode="set")), \`tool_result\` (tool output), \`auto_extract\` (automatic capture/seed), \`web_search\` (web results), \`reflection\` (agent reflection), \`llm_compress\` (compression summaries). View/edit source in management app detail panel.`,
  },
  {
    label: "rule:feature:confidence-diminishing-returns",
    tag: "rule:feature",
    content: `Confidence Diminishing Returns Feature
tag: rule:feature

memory(mode="verify") uses a diminishing-returns formula: confidence increases by \`0.2/(1+verificationCount)\`. First verify: +0.20, second: +0.10, third: +0.067. Each verification also increments verification_count. This prevents rapid confidence saturation.`,
  },
  {
    label: "rule:feature:auto-lessons",
    tag: "rule:feature",
    content: `Purpose-Centric Lessons Feature
tag: rule:feature

At session idle, the plugin auto-extracts a distilled \`lesson\` node (label \`lesson:<ts>\`, type \`lesson\`, tag \`sig:<failed-tools>\`) from the session's failed tool calls — what failed, on which files, and how to avoid it next time. Dedup: a lesson whose failure signature already exists in the store is skipped. Query them like any memory: searching with intent \`debug\` prioritizes \`lesson:\`/\`bug:\`/\`fix:\` nodes, and \`lesson:\`/\`decision:\`/\`convention:\`/\`fact:\` labels are ranked highest. use_llm (learn(mode="reflect")) and autoLessons.useLlm generate concrete prevention rules.`,
  },
  {
    label: "rule:feature:auto-capture",
    tag: "rule:feature",
    content: `Auto Work Capture Feature
tag: rule:feature

At session idle, the plugin distills a \`work:<ts>\` knowledge node (type \`knowledge\`, tag \`sess:<sessionId>\`) from the session's successful edit/write tool calls — what files were touched and which tools were used, optionally summarized by the LLM (autoCapture.useLlm). It is the success-mirror of auto-lessons: failures become \`lesson:\` nodes, completed work becomes \`work:\` nodes, so neither direction of the session history is lost. Config \`autoCapture {enabled: true, minEdits: 1, useLlm: false, maxPerSession: 3}\`. Dedup: a session is skipped once it has reached the per-session cap. This does not replace manual node creation — the agent should still call memory(mode="set") for significant completed work (features, bug fixes, benchmarks) at the time of completion, with learn(mode="verify") after.`,

  },
  {
    label: "rule:feature:dot-nodes",
    tag: "rule:feature",
    content: `Graphviz DOT Diagram Nodes
tag: rule:feature

To create a diagram node: memory(mode="set", type="dot", label="dot:<name>", content="digraph G { ... }").
The 'dot' type forces sticky (survives compression) and skips embedding generation (DOT is not semantic text — diagrams are browsed, not searched by vector).
Label MUST start with "dot:" prefix (e.g. "dot:auth-flow", "dot:context-compress-architecture") — the management app uses this prefix to identify and render DOT nodes.
content is raw Graphviz DOT source — use \\\\n for newlines if passing as a single string. Example:

  memory(mode="set", type="dot", label="dot:auth-flow", content="digraph G {\\n  rankdir=LR;\\n  node [shape=box, style=rounded];\\n  A -> B -> C;\\n}")

The ◈ Open Diagram button in the management app detail panel renders DOT nodes in-browser using viz.js WASM (no server needed).
Labels with "dot:" prefix receive the ×1.25 quality multiplier in ranking (same as lesson:/decision:/convention:/fact:).
DOT nodes are NOT retrievable by semantic search — this is intentional: architecture diagrams are browsed visually, not retrieved by keyword.`,
  },
  {
    label: "rule:feature:domain-classification",
    tag: "rule:feature",
    content: `Domain Classification Feature
tag: rule:feature

Memory nodes have a \`domain\` field (architecture | operations | knowledge | rules | history | patterns | preferences). Auto-derived from node type; view/edit in management app detail panel. Use \`domain_filter\` in memory(mode=search, ...) to filter results by domain.`,
  },
  {
    label: "rule:feature:memory-tool-usage",
    tag: "rule:feature",
    content: `Memory Tool Usage Best Practices
tag: rule:feature

Golden rule: Use the \`memory\` tool for ALL node CRUD (search/get/set/delete/list). Never use bash+sqlite3 — it bypasses embeddings, BM25, compression tracking, and triggers output compression overhead (scratch file stashing, pipe tangling).

Tool selection order: search (ALWAYS first, 100x cheaper than reading files) → drilldown/get (after search) → set (store discoveries) → replace (fix outdated) → delete (cleanup).

Search params: \`tagsFilter\` for intersection filtering; \`rerank\` and \`rerank_mode\` for keyword or cross-encoder reranking on ambiguous queries; feature weights come from the \`ranking.featureWeights\` config.

Source-of-truth linking: encode verification pointers as tags — \`file:src/foo.ts\`, \`fn:calculateTotal\`, \`commit:abc123\`, \`line:42\`, \`test:testCalculateTotal\`, \`cmd:make migrate\`. Searchable via \`tagsFilter\`. Every node should answer "where in the repo can this be checked?"

Mandatory summary+keywords: every \`memory_set\` must include \`summary\` (1-2 lines) + \`keywords\` (5-10 comma tokens) — separate \`keywords\` DB field BM25 ×2 for hub network vectors. Example: \`memory_set(label="fact:svelte-stack", content="We use Svelte 5...", type="fact", summary="Svelte 5 + Skeleton 5.0.1 with AppShell", keywords="svelte,skeleton,AppShell,runes,cerberus")\`. Auto-generated if omitted but explicit is better for search.

Cost: memory tool costs less than bash/SQL alternatives in every case — bash triggers compression system that creates scratch files and pipe tangles.

Iterative improvement: update this node when discovering new patterns, mistakes, or optimal parameter combos. Add learned mistakes at the bottom.`,
  },
  // Seed nodes (on-demand, not injected)
  {
    label: "memory-quick-start",
    tag: null,
    content: `## Memory Quick Start Guide

### First: Search Before Coding
Before starting any task, check memory:
- memory(mode="search", query="relevant topic")
- memory(mode="drilldown_query", query="what do I know about X?")

### Store These
- Architecture decisions (why we chose X)
- Bug workarounds
- User preferences
- Project conventions

### Don't Store
- Verbose logs
- Code snippets (already in codebase)
- Tool output dumps

### Memory-First Workflow
BEFORE: Search memory for context
DURING: Store decisions/patterns as you discover
AFTER: Summarize key decisions

### Token Budget
Keep memory lean. Use context(mode="check") if approaching limits.`,
  },
  {
    label: "memory-philosophy",
    tag: null,
    content: `## Memory Philosophy

Memory isn't about having information. It's about becoming better.

### What to Store
- Decisions: "We chose X because Y"
- Lessons: "Package Y needs --legacy-peer-deps"
- Preferences: "User prefers concise responses"
- Failures: "Compressed too aggressively"

### The Core Insight
Every node should make future-you smarter, not just more knowledgeable.

### Anti-Patterns
- memory(mode="list") dumps everything (expensive)
- Storing everything (token debt)
- Never compressing (node bloat)`,
  },
  {
    label: "persona",
    tag: null,
    content: `## Persona

You are a helpful, concise AI coding assistant.

### Communication Style
- Be brief and to the point
- Answer directly without preamble
- Use short sentences
- Avoid unnecessary elaboration

### When to Elaborate
- Only when asked for detail
- When user seems stuck
- When explaining complex concepts`,
  },
  {
    label: "human",
    tag: null,
    content: `## Human

The user is a developer working on their local machine.

### Preferences
- Prefers concise responses
- Direct communication style
- Wants working code, not lengthy explanations
- May ask clarifying questions

### Working Context
- Uses Bun as runtime and package manager
- OpenCode as AI coding assistant
- Plugin development experience`,
  },
  // Skill nodes (activated when relevant)
  {
    label: "skill:debug-workflow",
    tag: null,
    type: "skill",
    summary: "Systematic debugging workflow: reproduce, isolate, fix, verify. Use when debugging errors, fixing bugs, or investigating unexpected behavior.",
    metadata: { triggers: ["debug", "bug", "error", "fix", "crash", "broken", "not working", "investigate"] },
    content: `## Debug Workflow Skill

### When to Use
- User reports an error or bug
- Something is not working as expected
- Need to investigate unexpected behavior

### Procedure
1. **Reproduce**: Run the failing command or operation to see the exact error
2. **Isolate**: Identify the smallest reproducible case
3. **Read context**: Check relevant source files, logs, and recent changes
4. **Hypothesize**: Form a theory about the root cause
5. **Fix**: Make the minimal change to address the root cause
6. **Verify**: Run tests or the original operation to confirm the fix works
7. **Explain**: Tell the user what was wrong and how it was fixed

### Rules
- Never guess — always verify with actual output
- Check logs before changing code
- Make minimal diffs — don't refactor while debugging
- If stuck after 3 attempts, ask the user for more context`,
  },
  {
    label: "skill:write-tests",
    tag: null,
    type: "skill",
    summary: "Write comprehensive tests: unit, integration, edge cases. Use when asked to add tests, improve test coverage, or write test suites.",
    metadata: { triggers: ["test", "tests", "coverage", "spec", "assert", "unit test", "integration test"] },
    content: `## Write Tests Skill

### When to Use
- User asks to write tests for code
- Need to improve test coverage
- Adding tests for a new feature

### Procedure
1. **Find existing tests**: Look at the test directory structure and patterns
2. **Identify framework**: Check package.json for test runner (vitest, jest, etc.)
3. **Study patterns**: Read existing test files for conventions
4. **Write tests**: Cover happy path, edge cases, and error cases
5. **Run tests**: Verify all tests pass
6. **Check coverage**: Ensure meaningful coverage of the target code

### Rules
- Match existing test style and conventions exactly
- Test behavior, not implementation details
- Include at least one edge case per test file
- Never skip tests without a clear reason
- Run the test suite before declaring done`,
  },
  {
    label: "skill:refactor-component",
    tag: null,
    type: "skill",
    summary: "Safe refactoring: preserve behavior, improve structure, verify with tests. Use when restructuring code, renaming, extracting functions, or modernizing patterns.",
    metadata: { triggers: ["refactor", "restructure", "rename", "extract", "modernize", "clean up", "improve structure"] },
    content: `## Refactor Component Skill

### When to Use
- User asks to refactor or restructure code
- Need to rename, extract, or reorganize
- Modernizing outdated patterns

### Procedure
1. **Understand current behavior**: Read the code and any tests
2. **Define the goal**: What should the refactored code look like?
3. **Check for tests**: If none exist, write characterization tests first
4. **Refactor in small steps**: One change at a time, verify after each
5. **Run tests**: After each step, confirm behavior is preserved
6. **Review the diff**: Ensure the change is clean and focused

### Rules
- Never change behavior during a refactor
- Small, incremental changes only
- Tests must pass after every step
- If tests don't exist, write them first
- Keep the diff focused — don't mix refactoring with feature work`,
  },
  {
    label: "skill:refactoring-expert",
    tag: null,
    type: "skill",
    summary: "Systematic code refactoring following Martin Fowler's catalog: characterization tests, Red-Green-Refactor, incremental transformation. Covers SOLID compliance, DRY cleanup, code smell detection, complexity reduction, design patterns, functional programming.",
    metadata: { triggers: ["refactor", "SOLID", "DRY", "code smell", "technical debt", "legacy code", "extract method", "design pattern", "characterization test", "clean code", "functional programming"] },
    content: `## Refactoring Expert

## Purpose
Improve code quality and reduce technical debt through systematic refactoring following Martin Fowler's catalog, functional programming best practices, and industry standards.

## Triggers
Activate when working on:
- Code complexity reduction and technical debt elimination
- SOLID principles implementation and design pattern application
- Code quality improvement and maintainability enhancement
- Legacy code modernization and anti-pattern removal
- Test-driven refactoring and behavior preservation
- Characterization testing and safety nets
- Functional programming transformations (imperative to functional)
- Higher-order functions, composition, currying, and immutability
- Side effect elimination and pure function extraction

## Behavioral Mindset
Simplify relentlessly. Preserve behavior religiously. Measure everything.
Every refactoring must be: small and safe, tested immediately, measurably better.

## Focus Areas
- **Code Simplification**: Cyclomatic complexity reduction, readability improvement, function size optimization
- **Technical Debt Reduction**: Intentional and unintentional debt, DRY violations, code smells, anti-pattern elimination
- **Pattern Application**: SOLID principles, Gang of Four patterns, Fowler's refactorings, functional transformations
- **Safe Transformation**: Behavior preservation, automated tests, characterization tests, incremental changes

## Refactoring Protocol

### Phase 1: Assessment
- Measure baseline metrics (complexity, duplication, coupling)
- Identify code smells using 5-category taxonomy
- Detect SOLID violations and anti-patterns
- Prioritize high-impact, low-risk refactorings (80/20 rule)

### Phase 2: Safety Net Establishment
- Verify existing tests cover target code
- Add characterization tests if coverage insufficient
- Establish behavior baseline before changes

### Phase 3: Red-Green-Refactor Cycle
- **Red**: Write failing test defining desired behavior
- **Green**: Write minimal code to pass test
- **Refactor**: Improve design without changing behavior
- Run full test suite after each micro-step

### Phase 4: Pattern Application
- Apply SOLID principles systematically
- Choose appropriate paradigm (OOP / Functional)
- Introduce design patterns where appropriate

### Phase 5: Validation
- Measure post-refactoring metrics (compare to baseline)
- Verify behavior preservation through full test suite
- Review readability and maintainability gains

## Code Smells: 5 Categories
1. **Bloaters**: Long Method, Large Class, Long Parameter List, Primitive Obsession, Data Clumps
2. **Object-Orientation Abusers**: Switch Statements, Temporary Field, Refused Bequest
3. **Change Preventers**: Divergent Change, Shotgun Surgery, Parallel Inheritance
4. **Dispensables**: Comments (excessive), Duplicate Code, Dead Code, Lazy Class, Speculative Generality
5. **Couplers**: Feature Envy, Inappropriate Intimacy, Message Chains, Middle Man`,
  },
  {
    label: "skill:threejs-skills",
    tag: null,
    type: "skill",
    summary: "Create 3D scenes, interactive experiences, and visual effects using Three.js. Use when user requests 3D graphics, WebGL experiences, 3D visualizations, animations, or interactive 3D elements.",
    metadata: { triggers: ["3d", "three.js", "webgl", "rendering", "animation", "visualization", "scene", "mesh", "camera", "3d visualization"] },
    content: `## Three.js Skills
Systematically create high-quality 3D scenes and interactive experiences using Three.js best practices.

## When to Use
- Requests 3D visualizations or graphics
- Wants interactive 3D experiences
- Needs WebGL or canvas-based rendering
- Asks for animations, particles, or visual effects
- Wants to visualize data in 3D space

## Core Setup Pattern
### 1. Essential Three.js Imports
Always use the correct CDN version (r128):
\`\`\`javascript
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
\`\`\`

### 2. Scene Initialization
\`\`\`javascript
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
\`\`\`

### 3. Animation Loop
\`\`\`javascript
function animate() {
  requestAnimationFrame(animate);
  mesh.rotation.x += 0.01;
  mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();
\`\`\`

## Common Patterns
- Scene -> Camera -> Renderer initialization
- Geometry + Material = Mesh pattern
- requestAnimationFrame for continuous rendering
- Ambient + Directional lights for lit materials
- Window resize handler for responsiveness
- Raycaster for mouse interaction

## Best Practices
- Reuse geometries/materials for performance
- Set antialias: true on renderer
- Dispose resources on removal
- Use fog for atmospheric depth (FogExp2)
- Enable shadows for realism
- Prefer InstancedMesh for many identical objects
- Use GSAP for timeline-based animations`,
  },
  {
    label: "skill:customize-opencode",
    tag: null,
    type: "skill",
    summary: "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
    metadata: { triggers: ["opencode config", "agent", "skill", "plugin", "MCP", "permission", ".opencode"] },
    content: `## customize-opencode

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation.

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.

### 4. playground-link

Generates a Svelte Playground link with the provided code.`,
  },
  {
    label: "skill:svelte-code-writer",
    tag: null,
    type: "skill",
    summary: "CLI tools for Svelte 5 documentation lookup and code analysis. MUST be used whenever creating, editing or analyzing any Svelte component (.svelte) or Svelte module (.svelte.ts/.svelte.js). If possible, this skill should be executed within the svelte-file-editor agent for optimal results.",
    metadata: { triggers: ["svelte", "component", "svelte 5", "runes", "sveltekit"] },
    content: `## Svelte 5 Code Writer

## CLI Tools

You have access to @sveltejs/mcp CLI for Svelte-specific assistance. Use these commands via npx:

### List Documentation Sections

npx @sveltejs/mcp list-sections

Lists all available Svelte 5 and SvelteKit documentation sections with titles and paths.

### Get Documentation

npx @sveltejs/mcp get-documentation "<section1>,<section2>,..."

Retrieves full documentation for specified sections.

### Svelte Autofixer

npx @sveltejs/mcp svelte-autofixer "<code_or_path>" [options]

Analyzes Svelte code and suggests fixes for common issues.

Options: --async, --svelte-version (4 or 5)

## Workflow

1. Uncertain about syntax? Run list-sections then get-documentation for relevant topics
2. Reviewing/debugging? Run svelte-autofixer on the code to detect issues
3. Always validate - Run svelte-autofixer before finalizing any Svelte component`,
  },
  {
    label: "skill:svelte-core-bestpractices",
    tag: null,
    type: "skill",
    summary: "Guidance on writing fast, robust, modern Svelte code. Load this skill whenever in a Svelte project and asked to write/edit or analyze a Svelte component or module. Covers reactivity, event handling, styling, integration with libraries and more.",
    metadata: { triggers: ["svelte", "reactivity", "$state", "$derived", "$effect", "$props", "svelte best practices", "runes", "snippet", "event handler"] },
    content: `## svelte-core-bestpractices

## $state

Only use the $state rune for variables that should be reactive. Objects and arrays are made deeply reactive. Use $state.raw for large objects that are only ever reassigned.

## $derived

To compute something from state, use $derived rather than $effect. Deriveds are writable.

## $effect

Effects are an escape hatch and should mostly be avoided. Do not update state inside effects.

## $props

Treat props as though they will change. Values that depend on props should use $derived.

## Events

Any element attribute starting with on is treated as an event listener.

## Snippets

Use {#snippet ...} and {@render ...} for reusable markup instead of <slot>.

## Each blocks

Prefer keyed each blocks for better performance.

## Styling

Use CSS custom properties for parent-to-child styling. Use :global for library overrides.

## Context

Use createContext rather than setContext and getContext for type safety.

## Avoid legacy features

Always use runes mode for new code:
- $state instead of implicit reactivity
- $derived and $effect instead of $:
- $props instead of export let
- onclick={...} instead of on:click={...}
- {#snippet ...} and {@render ...} instead of <slot>
- classes with $state fields instead of stores`,
  },
  // Playbook nodes (sticky, type: "playbook", steps in metadata)
  {
    label: "playbook:debug-workflow",
    tag: null,
    type: "playbook",
    summary: "Systematic debugging: reproduce, isolate, fix, verify. Use when debugging errors or investigating unexpected behavior.",
    metadata: {
      steps: [
        { toolName: "bash", description: "Reproduce the error — run the failing command", params: {}, critical: true },
        { toolName: "read", description: "Read relevant source files and logs", params: {}, critical: false },
        { toolName: "bash", description: "Run any diagnostic commands to gather context", params: {}, critical: false },
        { toolName: "edit", description: "Apply the minimal fix", params: {}, critical: true },
        { toolName: "bash", description: "Verify the fix works", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["debug", "bug", "error", "fix", "crash", "broken"] }],
      tags: ["debugging", "workflow"],
      executionCount: 0,
    },
    content: `## Debug Workflow Playbook

Systematic debugging workflow for resolving errors and unexpected behavior.

### Steps
1. Reproduce the error by running the failing command
2. Read relevant source files, logs, and recent changes
3. Run diagnostics to gather context about the failure
4. Apply the minimal fix to address the root cause
5. Verify the fix by re-running the original operation

### Rules
- Never guess — always verify with actual output
- Make minimal diffs — don't refactor while debugging
- If stuck after 3 attempts, ask the user for more context`,
  },
  {
    label: "playbook:write-tests",
    tag: null,
    type: "playbook",
    summary: "Write comprehensive tests: unit, integration, edge cases. Use when asked to add tests or improve coverage.",
    metadata: {
      steps: [
        { toolName: "read", description: "Find existing tests and study patterns", params: {}, critical: false },
        { toolName: "read", description: "Read the source code being tested", params: {}, critical: true },
        { toolName: "edit", description: "Write tests covering happy path + edge cases", params: {}, critical: true },
        { toolName: "bash", description: "Run the test suite to verify", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["test", "tests", "coverage", "spec"] }],
      tags: ["testing", "workflow"],
      executionCount: 0,
    },
    content: `## Write Tests Playbook

Write comprehensive tests matching existing project conventions.

### Steps
1. Find existing tests and study naming/structure patterns
2. Read the source code to understand behavior
3. Write tests covering happy path, edge cases, and error cases
4. Run the test suite and verify all tests pass

### Rules
- Match existing test style exactly
- Test behavior, not implementation`,
  },
  {
    label: "playbook:refactor-component",
    tag: null,
    type: "playbook",
    summary: "Safe refactoring: preserve behavior, improve structure, verify. Use when restructuring code or modernizing patterns.",
    metadata: {
      steps: [
        { toolName: "read", description: "Understand current code and tests", params: {}, critical: true },
        { toolName: "bash", description: "Run existing tests to establish baseline", params: {}, critical: false },
        { toolName: "edit", description: "Refactor in small incremental steps", params: {}, critical: true },
        { toolName: "bash", description: "Run tests after each step to verify", params: {}, critical: true },
        { toolName: "bash", description: "Review the final diff for cleanliness", params: {}, critical: false },
      ],
      triggers: [{ type: "task_keyword", keywords: ["refactor", "restructure", "extract", "clean up"] }],
      tags: ["refactoring", "workflow"],
      executionCount: 0,
    },
    content: `## Refactor Component Playbook

Safe behavior-preserving refactoring.

### Steps
1. Read the code and any tests thoroughly
2. Run tests to establish a passing baseline
3. Refactor one small change at a time
4. Run tests after each step (behavior preserved?)
5. Review the final diff — clean and focused?

### Rules
- Never change behavior during a refactor
- Small, incremental changes only
- Write characterization tests first if none exist`,
  },
  {
    label: "playbook:code-review",
    tag: null,
    type: "playbook",
    summary: "Systematic code review: correctness, structure, security, style. Use when reviewing PRs or code changes.",
    metadata: {
      steps: [
        { toolName: "read", description: "Read the entire diff — understand what changed", params: {}, critical: true },
        { toolName: "bash", description: "Check that tests exist and pass for the changed code", params: {}, critical: false },
        { toolName: "read", description: "Review for error handling, edge cases, and security", params: {}, critical: true },
        { toolName: "edit", description: "Suggest improvements — never rewrite without discussion", params: {}, critical: false },
      ],
      triggers: [{ type: "task_keyword", keywords: ["review", "PR", "pull request", "code review"] }],
      tags: ["review", "workflow"],
      executionCount: 0,
    },
    content: `## Code Review Playbook

Systematic code review checklist.

### Steps
1. Read the full diff to understand what changed and why
2. Verify tests cover the changes and pass
3. Check for error handling, edge cases, and security issues
4. Suggest focused improvements

### Key Checks
- Correctness: Does the code do what it intends?
- Structure: Is it well-organized and maintainable?
- Security: Any injection vectors or exposed secrets?
- Style: Follows project conventions?`,
  },
  {
    label: "playbook:security-audit",
    tag: null,
    type: "playbook",
    summary: "Security audit checklist: input validation, auth, secrets, deps. Use when deploying to production or reviewing security.",
    metadata: {
      steps: [
        { toolName: "read", description: "Check for hardcoded secrets and credentials", params: {}, critical: true },
        { toolName: "read", description: "Review input validation on all user-facing endpoints", params: {}, critical: true },
        { toolName: "read", description: "Review authentication and authorization logic", params: {}, critical: true },
        { toolName: "bash", description: "Check for known vulnerable dependencies", params: {}, critical: false },
        { toolName: "bash", description: "Verify env/config files are not committed", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["security", "audit", "deploy", "production"] }],
      tags: ["security", "workflow"],
      executionCount: 0,
    },
    content: `## Security Audit Playbook

Pre-deployment security checklist.

### Steps
1. Scan for hardcoded secrets, tokens, passwords
2. Verify input validation on all user-facing paths
3. Review authentication and authorization logic
4. Check dependencies for known vulnerabilities
5. Ensure .env and config files aren't committed

### Critical Rule
- Flag any hardcoded credential immediately — never commit`,
  },
  {
    label: "playbook:plan-feature",
    tag: null,
    type: "playbook",
    summary: "Structure new feature development: spec, breakdown, implement, verify. Use when starting a new feature or significant change.",
    metadata: {
      steps: [
        { toolName: "task", description: "Clarify requirements — ask questions about scope and constraints", params: {}, critical: true },
        { toolName: "read", description: "Explore the existing codebase for patterns and integration points", params: {}, critical: false },
        { toolName: "edit", description: "Write a spec or plan before coding", params: {}, critical: false },
        { toolName: "edit", description: "Implement in thin vertical slices", params: {}, critical: true },
        { toolName: "bash", description: "Test each slice before moving to the next", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["feature", "implement", "plan", "new", "design"] }],
      tags: ["planning", "workflow"],
      executionCount: 0,
    },
    content: `## Plan Feature Playbook

Structured feature development from spec to implementation.

### Steps
1. Clarify requirements with the user (scope, constraints, acceptance criteria)
2. Explore relevant parts of the existing codebase
3. Write a structured plan or specification
4. Implement in thin vertical slices
5. Test each slice before moving on

### Rules
- Understand the problem before proposing solutions
- Small, verifiable increments
- Test early, test often`,
  },
  {
    label: "rule:standard:playbook-creation",
    tag: "rule:standard",
    content: `## Playbook Creation Rule
tag: rule:standard

### When to Propose a Playbook
- You notice the user performing the same multi-step workflow 2+ times
- A task involves 4+ steps that could be standardized
- You find yourself repeating a sequence of tools

### How to Propose
Use memory(mode="set") to create the playbook:
\`memory(mode="set", label="playbook:<short-name>", content="<description>", type="playbook", sticky=true, metadata={ steps: [{ toolName, description, params: {}, critical: true/false }], triggers: [...], tags: [...] })\`

### Format
- Label: \`playbook:<short-hyphenated-name>\`
- Type: \`"playbook"\`
- Sticky: \`true\`
- Steps in \`metadata.steps\` array
- Triggers in \`metadata.triggers\` (keyword or tool_sequence patterns)
- Content: human-readable description of the workflow`,
  },
  {
    label: "skill:security-review",
    tag: null,
    type: "skill",
    summary: "Security review checklist: input validation, auth, secrets, dependencies. Use when reviewing code for security issues or before deploying.",
    metadata: { triggers: ["security", "vulnerability", "auth", "secret", "token", "password", "review", "deploy"] },
    content: `## Security Review Skill

### When to Use
- Reviewing code for security issues
- Before deploying to production
- User mentions security concerns

### Checklist
1. **Input validation**: All user inputs are validated/sanitized
2. **Authentication**: Protected routes require auth
3. **Authorization**: Users can only access their own data
4. **Secrets**: No hardcoded secrets, tokens, or passwords
5. **Dependencies**: No known vulnerable packages
6. **Error handling**: Errors don't leak sensitive information
7. **Rate limiting**: Public endpoints have rate limiting
8. **CORS**: Proper CORS configuration
9. **SQL injection**: Parameterized queries only
10. **XSS**: Output is properly escaped

### Rules
- Flag any hardcoded credentials immediately
- Never commit .env files
- Use parameterized queries for all database operations
- Validate all user input on the server side`,
  },
  {
    label: "skill:code-reviewer",
    tag: null,
    type: "skill",
    summary: "Multi-axis code review: correctness, security, performance, maintainability, testing. Use when asked to review code, evaluate a PR, audit changes, or assess code quality before merge. Severity-classified output with file+line references.",
    metadata: { triggers: ["review", "code review", "PR", "pull request", "merge", "audit", "code quality", "code assessment", "diff review", "changeset review"] },
    content: `## Code Reviewer

Conducts multi-axis code review with severity-classified findings. Every change gets reviewed before merge.

### When to Use
- Before merging any PR or change
- After completing a feature implementation
- When evaluating code written by yourself, another agent, or a human
- When refactoring existing code
- After any bug fix (review both the fix and the tests)

### The Five-Axis Review
Evaluate every change across these dimensions, in priority order:

#### 1. Correctness
- Edge cases: null, empty, boundary values, negative numbers, zero
- Off-by-one errors: \`<\` vs \`<=\`, array indices, pagination
- Error handling: timeouts, 500s, connection drops, partial failures
- Idempotency: is it safe to retry or call twice?
- Data types: integer overflow, float precision, implicit coercions
- Contracts: input validated? Output matches interface?

#### 2. Security
- Injections: SQL, NoSQL, command injection, XSS
- Authentication: every protected endpoint verifies identity
- Authorization: users access only their own data
- Secrets: no hardcoded keys, tokens, passwords
- Logging: no PII or secrets in logs
- Deserialization: input validated before parsing
- Dependencies: known CVEs in imported packages

#### 3. Performance
- N+1 queries: loop with a database call inside
- Algorithm complexity: nested loops over the same data
- Unbounded operations: no limit on queries or iterations
- Blocking in async: synchronous I/O in request handlers
- Payload size: over-fetching, large response bodies

#### 4. Maintainability
- Naming: variables and functions reflect their purpose
- Function size: more than 40 lines – candidate for splitting
- Comments: explain "why", not "what"
- Dead code: unused variables, unreachable branches
- Duplication: same logic in multiple places
- Typing: concrete types instead of \`any\` / \`object\`

#### 5. Testing
- Tests verify behavior, not implementation details
- Edge cases from correctness review have corresponding tests
- Error/failure paths tested (not just happy path)
- Mocks are minimal (only external dependencies)
- Assertions are specific, not generic

### Finding Format
Every finding includes:
- **Severity**: \`🔴 Blocker\` (must fix before merge) | \`🟡 Warning\` (should fix) | \`💭 Suggestion\` (nice to have)
- **File**: Path to the file
- **Line**: Line number reference
- **Issue**: One-sentence description
- **Recommendation**: Specific fix suggestion

### Rules
- Review in priority order: Correctness → Security → Performance → Maintainability → Testing
- Be specific: cite file and line for every finding
- Explain why, not just what
- Suggest, don't demand — the author may have context you lack
- Praise good code where it exists
- Ship one complete review — no drip-feeding rounds
- Don't block a change because it isn't exactly how you'd write it`,
  },
  {
    label: "skill:ai-code-pitfalls",
    tag: null,
    type: "skill",
    summary: "Detects failure modes unique to AI-generated code: hallucinated imports, phantom APIs, outdated patterns, over-engineering, confident-but-wrong logic. Use when reviewing code generated by an AI assistant.",
    metadata: { triggers: ["AI generated", "AI code", "hallucinated", "phantom API", "copilot", "cursor", "AI assistant", "generated code", "LLM output"] },
    content: `## AI Code Pitfalls Review

AI-generated code has specific failure modes that differ from human-written code. This skill checks for those patterns specifically.

### When to Use
- Reviewing code written by an AI assistant
- After using Copilot, Cursor, Claude Code, or any code generation tool
- Evaluating generated code before merge
- Any PR where a significant portion is AI-generated

### The 7 AI-Specific Checks

#### 1. Hallucinated Imports and Packages
- Every new import resolves to an actual installed package
- Package names are real (not plausible-looking fakes)
- Run \`npm info <package>\` (or equivalent) for suspicious new deps
- Check version compatibility with existing lockfile

#### 2. Phantom API Endpoints and Functions
- Every API call matches actual route definitions
- Function signatures match real library documentation
- No made-up parameters, properties, or methods
- Cross-reference with official docs for unfamiliar APIs

#### 3. Outdated Patterns and Deprecated APIs
- Code uses current API versions (not 2-year-old syntax)
- No deprecated patterns from the frameworks in use
- Import paths match the project's dependency versions
- No "it compiled so it must be right" assumptions

#### 4. Over-Engineering and Premature Abstraction
- Every abstraction is justified by actual usage, not predicted needs
- No generic "utility" functions used exactly once
- No factory patterns for a single implementation
- The solution is proportional to the problem

#### 5. Confident-But-Wrong Logic
- Business logic verified against actual requirements
- Math, dates, pagination, and sort order manually traced
- Edge cases produce correct results, not just plausible ones
- Test with specific input values to verify output

#### 6. Hallucinated Test Assertions
- Tests verify actual behavior, not what the code happens to do
- A failing test would actually fail if the logic were wrong
- No tests that pass trivially (empty assertions, always-true conditions)
- Test data is realistic, not circular

#### 7. Scope Creep and Hidden Changes
- Change does only what was requested — nothing extra
- No unrelated refactoring mixed into the diff
- No "drive-by improvements" that weren't asked for
- No deleted or renamed code outside the task scope

### Procedure
1. **Scan imports first** — verify every new dependency and import resolves
2. **Verify API calls** — cross-reference unfamiliar functions with docs
3. **Trace logic** — run through one real input and one edge case manually
4. **Check diff scope** — ensure changes match the task, nothing more
5. **Review tests** — confirm they test behavior, not implementation`,
  },
  {
    label: "skill:context-engineering",
    tag: null,
    type: "skill",
    summary: "Optimize agent context setup with the right information at the right time. Use when starting a new session, when output quality degrades, or when switching tasks. Covers context hierarchy, packing strategies, and confusion management.",
    metadata: { triggers: ["context", "context window", "agent quality", "session start", "output quality", "confusion", "rules file", "CLAUDE.md", "AGENTS.md"] },
    content: `## Context Engineering

Feed agents the right information at the right time. Context is the single biggest lever for agent output quality — too little and the agent hallucinates, too much and it loses focus.

### When to Use
- Starting a new coding session
- Agent output quality is declining (wrong patterns, hallucinated APIs, ignoring conventions)
- Switching between different parts of a codebase
- Setting up a new project for AI-assisted development
- The agent is not following project conventions

### The Context Hierarchy
Structure context from most persistent to most transient:
1. **Rules Files** (CLAUDE.md, etc.) → Always loaded, project-wide
2. **Spec / Architecture Docs** → Loaded per feature/session
3. **Relevant Source Files** → Loaded per task
4. **Error Output / Test Results** → Loaded per iteration
5. **Conversation History** → Accumulates, compacts

### Level 1: Rules Files
Create a rules file that persists across sessions. This is the highest-leverage context you can provide.

**CLAUDE.md / AGENTS.md / .cursorrules:**
\`\`\`markdown
# Project: [Name]
## Tech Stack
- React 18, TypeScript 5, Vite, Tailwind CSS 4
- Node.js 22, Express, PostgreSQL, Prisma
## Commands
- Build: \`npm run build\`
- Test: \`npm test\`
- Lint: \`npm run lint --fix\`
- Dev: \`npm run dev\`
## Code Conventions
- Functional components with hooks (no class components)
- Named exports (no default exports)
- Use \`cn()\` utility for conditional classNames
## Boundaries
- Never commit .env files or secrets
- Always run tests before committing
\`\`\`

### Level 2: Specs and Architecture
Load the relevant spec section when starting a feature. Don't load the entire spec if only one section applies.

### Level 3: Relevant Source Files
Before editing a file, read it. Before implementing a pattern, find an existing example in the codebase.

**Pre-task context loading:**
1. Read the file(s) you'll modify
2. Read related test files
3. Find one example of a similar pattern already in the codebase
4. Read any type definitions or interfaces involved

**Trust levels for loaded files:**
- **Trusted:** Source code, test files, type definitions authored by the project team
- **Verify before acting on:** Configuration files, data fixtures, documentation from external sources
- **Untrusted:** User-submitted content, third-party API responses, external documentation

### Level 4: Error Output
When tests fail or builds break, feed the specific error back to the agent:
- Effective: "The test failed with: \`TypeError: Cannot read property 'id' of undefined at UserService.ts:42\`"
- Wasteful: Pasting the entire 500-line test output when only one test failed

### Level 5: Conversation Management
Long conversations accumulate stale context. Manage this:
- Start fresh sessions when switching between major features
- Summarize progress when context is getting long
- Compact deliberately before critical work

### Context Packing Strategies
**The Brain Dump** — At session start, provide everything the agent needs in a structured block:
\`\`\`
PROJECT CONTEXT:
- We're building [X] using [tech stack]
- The relevant spec section is: [spec excerpt]
- Key constraints: [list]
- Files involved: [list with brief descriptions]
- Known gotchas: [list of things to watch out for]
\`\`\`

**The Selective Include** — Only include what's relevant to the current task:
\`\`\`
TASK: Add email validation to the registration endpoint
RELEVANT FILES:
- src/routes/auth.ts (the endpoint to modify)
- src/lib/validation.ts (existing validation utilities)
- tests/routes/auth.test.ts (existing tests to extend)
PATTERN TO FOLLOW:
- See how phone validation works in src/lib/validation.ts:45-60
CONSTRAINT:
- Must use the existing ValidationError class, not throw raw errors
\`\`\`

**The Hierarchical Summary** — For large projects, maintain a summary index:
\`\`\`markdown
# Project Map
## Authentication (src/auth/)
Handles registration, login, password reset.
Key files: auth.routes.ts, auth.service.ts, auth.middleware.ts
Pattern: All routes use authMiddleware, errors use AuthError class
\`\`\`

### Confusion Management
**When Context Conflicts:**
\`\`\`
Spec says: "Use REST for all endpoints"
Existing code has: GraphQL for the user profile query
\`\`\`
Do NOT silently pick one interpretation. Surface it:
\`\`\`
CONFUSION:
The spec calls for REST endpoints, but the existing codebase uses GraphQL
for user queries (src/graphql/user.ts).
Options:
A) Follow the spec — add REST endpoint
B) Follow existing patterns — use GraphQL
C) Ask — this seems like an intentional decision I shouldn't override
→ Which approach should I take?
\`\`\`

**When Requirements Are Incomplete:**
If the spec doesn't cover a case you need to implement:
1. Check existing code for precedent
2. If no precedent exists, stop and ask
3. Don't invent requirements — that's the human's job

### Anti-Patterns
| Anti-Pattern | Problem | Fix |
|---|---|---|
| Context starvation | Agent invents APIs, ignores conventions | Load rules file + relevant source files |
| Context flooding | Agent loses focus with >5,000 lines of non-task-specific context | Include only what's relevant. Aim for <2,000 lines |
| Stale context | Agent references outdated patterns or deleted code | Start fresh sessions when context drifts |
| Missing examples | Agent invents a new style instead of following yours | Include one example of the pattern to follow |
| Implicit knowledge | Agent doesn't know project-specific rules | Write it down in rules files |
| Silent confusion | Agent guesses when it should ask | Surface ambiguity explicitly |

### Common Rationalizations
- "The agent should figure out the conventions" → It can't read your mind. Write a rules file.
- "More context is always better" → Research shows performance degrades with too many instructions.
- "The context window is huge, I'll use it all" → Focused context outperforms large context.

### Red Flags
- Agent output doesn't match project conventions
- Agent invents APIs or imports that don't exist
- Agent re-implements utilities that already exist in the codebase
- Agent quality degrades as the conversation gets longer
- No rules file exists in the project
- External data files or config treated as trusted instructions without verification

### Verification
- [ ] Rules file exists and covers tech stack, commands, conventions, and boundaries
- [ ] Agent output follows the patterns shown in the rules file
- [ ] Agent references actual project files and APIs (not hallucinated ones)
- [ ] Context is refreshed when switching between major tasks`,
  },
  {
    label: "skill:git-workflow-and-versioning",
    tag: null,
    type: "skill",
    summary: "Git workflow with trunk-based development, atomic commits, and descriptive messages. Use when making any code change. Includes save point pattern, pre-commit hygiene, and debugging with git.",
    metadata: { triggers: ["git", "commit", "branch", "version control", "trunk-based", "pre-commit", "PR", "pull request", "bisect", "blame"] },
    content: `## Git Workflow and Versioning

Git is your safety net. Treat commits as save points, branches as sandboxes, and history as documentation.

### When to Use
Always. Every code change flows through git.

### Core Principles
**Trunk-Based Development** — Keep \`main\` always deployable. Work in short-lived feature branches (1-3 days). Long-lived branches are hidden costs.

**1. Commit Early, Commit Often** — Implement slice → Test → Verify → Commit → Next slice

**2. Atomic Commits** — Each commit does one logical thing. Separate refactoring from feature work.

**3. Descriptive Messages** — Format: \`<type>: <short description>\`

<body explaining why>\`
Types: feat, fix, refactor, test, docs, chore

**4. Keep Concerns Separate** — Don't combine formatting with behavior changes. Don't combine refactors with features.

**5. Size Your Changes** — ~100 lines per commit/PR. ~1000 lines → split.

### Branching Strategy
- \`feature/<short-description>\` — One feature per branch
- \`fix/<short-description>\` — Bug fixes
- \`chore/<short-description>\` — Tooling, dependencies
- \`refactor/<short-description>\` — Code restructuring
- Delete branches after merge
- Prefer feature flags over long-lived branches

### The Save Point Pattern
Agent starts work → Makes a change → Test passes? → Commit → Continue. Test fails? → Revert to last commit → Investigate.

### Change Summaries
After any modification, provide:
\`\`\`
CHANGES MADE:
- file: what changed

THINGS I DIDN'T TOUCH (intentionally):
- file: why not

POTENTIAL CONCERNS:
- anything to flag
\`\`\`

### Pre-Commit Hygiene
1. \`git diff --staged\` — Check what you're committing
2. Check for secrets: \`git diff --staged | grep -i "password\\|secret\\|api_key\\|token"\`
3. Run tests: \`npm test\`
4. Run linting: \`npm run lint\`
5. Run type checking: \`npx tsc --noEmit\`

### Using Git for Debugging
- \`git bisect start\` → \`git bisect bad\` → \`git bisect good <sha>\` — Find which commit introduced a bug
- \`git log --oneline -20\` — View recent changes
- \`git blame file\` — Find who last changed a specific line

### Common Rationalizations
- "I'll commit when the feature is done" → One giant commit is impossible to review
- "The message doesn't matter" → Messages are documentation
- "Branches add overhead" → Short-lived branches are free, long-lived are the problem

### Red Flags
- Large uncommitted changes accumulating
- Commit messages like "fix", "update", "misc"
- Formatting changes mixed with behavior changes
- No .gitignore in the project
- Committing node_modules/, .env, or build artifacts
- Long-lived branches diverging from main
- Force-pushing to shared branches

### Verification
- [ ] Commit does one logical thing
- [ ] Message explains the why, follows type conventions
- [ ] Tests pass before committing
- [ ] No secrets in the diff
- [ ] No formatting-only changes mixed with behavior changes
- [ ] .gitignore covers standard exclusions`,
  },
  {
    label: "skill:incremental-implementation",
    tag: null,
    type: "skill",
    summary: "Build in thin vertical slices with implement-test-verify-commit cycle. Use when implementing any multi-file change or feature. Includes slicing strategies, scope discipline, and increment checklist.",
    metadata: { triggers: ["implement", "feature", "slice", "vertical slice", "increment", "multi-file", "refactor", "scope", "task breakdown"] },
    content: `## Incremental Implementation

Build in thin vertical slices — implement one piece, test it, verify it, then expand. Avoid implementing an entire feature in one pass.

### When to Use
- Implementing any multi-file change
- Building a new feature from a task breakdown
- Refactoring existing code
- Any time you're tempted to write more than ~100 lines before testing

### The Increment Cycle
Implement → Test → Verify → Commit → Next slice

### Slicing Strategies
**Vertical Slices (Preferred)** — Build one complete path through the stack:
- Slice 1: Create a task (DB + API + basic UI) → Tests pass, user can create a task
- Slice 2: List tasks (query + API + UI) → Tests pass, user can see their tasks
- Slice 3: Edit a task → Tests pass, user can modify tasks
- Slice 4: Delete a task → Tests pass, full CRUD complete

**Contract-First Slicing** — Define API contract first, then implement backend and frontend in parallel.

**Risk-First Slicing** — Tackle the riskiest or most uncertain piece first.

### Implementation Rules
**Rule 0: Simplicity First** — "What is the simplest thing that could work?" Three similar lines is better than a premature abstraction.

**Rule 0.5: Scope Discipline** — Touch only what the task requires. Do NOT "clean up" adjacent code, refactor imports, remove comments, add features not in spec, or modernize syntax. If you notice something worth improving, note it — don't fix it.

**Rule 1: One Thing at a Time** — Each increment changes one logical thing. Don't mix concerns.

**Rule 2: Keep It Compilable** — After each increment, the project must build and existing tests must pass.

**Rule 3: Feature Flags for Incomplete Features** — If a feature isn't ready for users but you need to merge increments.

**Rule 4: Safe Defaults** — New code should default to safe, conservative behavior.

**Rule 5: Rollback-Friendly** — Each increment should be independently revertable.

### Increment Checklist
- [ ] The change does one thing and does it completely
- [ ] All existing tests still pass
- [ ] The build succeeds
- [ ] Type checking passes
- [ ] Linting passes
- [ ] The new functionality works as expected
- [ ] The change is committed with a descriptive message

### Common Rationalizations
- "I'll test it all at the end" → Bugs compound
- "It's faster to do it all at once" → Feels faster until something breaks
- "These changes are too small to commit separately" → Small commits are free
- "This refactor is small enough to include" → Separate refactoring from features

### Red Flags
- More than 100 lines of code written without running tests
- Multiple unrelated changes in a single increment
- "Let me just quickly add this too" scope expansion
- Skipping the test/verify step
- Build or tests broken between increments
- Large uncommitted changes accumulating
- Building abstractions before the third use case demands it
- Touching files outside the task scope "while I'm here"

### Verification
- [ ] Each increment was individually tested and committed
- [ ] The full test suite passes
- [ ] The build is clean
- [ ] The feature works end-to-end as specified
- [ ] No uncommitted changes remain`,
  },
  {
    label: "skill:opencode-plugin-installation",
    tag: null,
    type: "skill",
    summary: "Install, update, and troubleshoot fractal-memory plugin in OpenCode. Use when installing, updating, upgrading, or troubleshooting plugin loading issues.",
    metadata: { triggers: ["installation", "update", "upgrade", "cache", "stale", "version", "publish", "npm pack", "plugin not loading", "plugin error"] },
    content: `## OpenCode Plugin Installation

### When to Use
- Installing opencode-fractal-memory for the first time
- Plugin version is out of date or stale
- After publishing a new version to npm
- Troubleshooting plugin loading issues

### How to Install
Add to \`~/.config/opencode/opencode.json\`:
\`\`\`json
{ "plugin": ["opencode-fractal-memory"] }
\`\`\`
OpenCode installs it automatically at startup.

### How to Update
OpenCode caches plugins at \`~/.cache/opencode/packages/\`. When a new version is published, the cache may stay pinned to the old version due to bun's dual caching. Two approaches:

**Approach 1 — dev-install script (RECOMMENDED for local development):**
\`\`\`bash
cd /path/to/opencode-fractal-memory
bun run dev-install                # build + clean + sync to the plugin cache @latest path
bun run dev-install --skip-build   # skip tsc, just sync
\`\`\`
The script (scripts/dev-install.ts) wipes the plugin cache dir \`~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/\` (the ONLY location OpenCode loads — beacon-proven via the \`PLUGIN_LOADED_FROM\` startup log in \`~/.config/opencode/logs/memory-plugin.log\`; the legacy \`~/.config/opencode/node_modules\` copy is cleaned for npm-pack compat only, never read by OpenCode), copies all files (dist management package.json LICENSE README.md commands agent scripts) plus runtime deps, prints a RESTART REQUIRED warning, and exits non-zero if dist is missing from the cache. Then RESTART OpenCode and verify: \`grep "PLUGIN_LOADED_FROM" ~/.config/opencode/logs/memory-plugin.log\` — \`resolvedDir\` must be the cache @latest path.

**Approach 2 — npm publish (production):**
\`\`\`bash
npm version patch --no-git-tag-version
npm run build && npm test
npm publish
git commit -am "v0.7.x" && git tag v0.7.x
\`\`\`

### npm v12 Note
As of npm v12 (July 2026), \`--ignore-scripts\` is the default — \`postinstall\` scripts no longer run automatically. Our plugin's \`postinstall\` (model download + file copies) has a fallback via \`ensureModels()\` during plugin init, so no functionality breaks.

### Troubleshooting
- **Plugin not loading**: Check logs at \`~/.config/opencode/logs/memory-plugin.log\`
- **Stale version**: The cache at \`~/.cache/opencode/packages/\` must be synced manually — npm install alone is insufficient (only touches \`~/.config/opencode/node_modules\`, which OpenCode never loads). Use \`bun run dev-install\` (local) or \`cd ~/.cache/opencode/packages/opencode-fractal-memory@latest && bun add opencode-fractal-memory@latest\` (published)
- **"The path property must be of type string, got object"**: Known OpenCode bug (#12589, #7082) in the npm plugin resolver. Non-blocking — plugin works anyway
- **UNIQUE constraint errors**: Fixed in v0.6.23+ via \`INSERT OR IGNORE\` — ensure you're on the latest version`,
  },
  {
    label: "rule:feature:command-compression",
    tag: "rule:feature",
    type: "rule",
    summary: "Bash tool output may be compressed. First line shows [Compressed via <strategy>]. Full output on non-zero exit. Use ! to bypass.",
    content: `Bash command output may be compressed via one of 7 strategies (ls, test, grep, git-status, git-log, git-diff, git-quick, truncate, generic). The first line shows [Compressed via <strategy> — original: N chars, now: M chars]. Full output is preserved on non-zero exit (tee mode). View stats at management app → Compress tab.`,
  },
  {
    label: "rule:feature:auto-retrieve",
    tag: "rule:feature",
    type: "rule",
    summary: "Memory search results may be reranked by LLM or fallback scorer. Higher relevance = better match for current task.",
    content: `Memory search results may be reranked by an LLM judge or fallback scorer based on your current reasoning context. Results show a '## Reranked Memory Results' header with relevance percentages. Higher relevance = better match for your current task.`,
  },
];



