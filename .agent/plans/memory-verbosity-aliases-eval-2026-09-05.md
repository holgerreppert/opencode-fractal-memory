# Plan: Memory UX — Verbose Descriptions + Aliases + Eval (2026-09-05)

**Branch:** `feat/memory-ux-verbose-aliases` from `main 956d67f v0.8.4`
**Decisions:** 1 aliases yes, 2 verbose clarity > tokens, 3 eval loop ok. Scope stays `default: project` per user.
**Research:** Anthropic `writing-tools-for-agents` Sep2025 (describe to new hire, namespacing `asana_search`, strict schemas, evaluation via redundant/invalid-param metrics, Muse 3.5 SWE-bench SOTA after description refinements) + Google ADK `instruction most critical + few-shot` + opencode-mem forks (tickernelz 1.6k `scope project|all-projects`, shangobashi example `all-projects`, simple-memory 9 distinct `memory_remember|recall...` with type table, honcho 7 `honcho_search|chat|create_conclusion`, memory-adapter `scope global|project`).

## P0 — Verbose Descriptions (Anthropic highest lever, maps to 53+ ToolDefinitions)
- **File:** `src/plugin/tools.ts`
- **Action:** Rewrite 9 `memory` modes (`search,get,fetch,drilldown,drilldown_query,set,replace,delete,list`) + 3 `context/learn/journal` from 1-line → ~4-6 lines each (~180 tok total):
  ```
  memory_search: Search memories. USE WHEN prior decisions/lessons/conventions needed BEFORE answering. ALWAYS first — 100× cheaper than read. Use concise keywords (not raw task). Workflow: search → if >50% match drilldown/get → then set. Params: query, tagsFilter intersection, limit, rerank. Ex: memory(mode="search", query="auth JWT verification", limit=5). See also: graph(search) for symbols, context(check) for pressure. On 0 results try tagsFilter=["file:src/foo.ts"] or rerank_mode=cross-encoder.
  ```
  Model off `graph` good example. Keep consolidated `memory` impl.

## P1 — Aliases (solve 9-mode confusion per #1)
- **File:** `src/plugin/tools.ts`, `src/plugin/hooks/tool-definition.ts` if needed
- **Action:** Keep consolidated `memory` cache compat, add 4 namespaced wrappers sharing impl: `memory_search`, `memory_fetch`, `memory_get`, `memory_set` (optionally `memory_list`). Each alias description repeats verbose block with `alias for memory(mode="...")`. Top-level 53→57 (<20 memory-family).

## P2 — Instruction Supplement (Google ADK)
- **File:** `src/seed-nodes.ts:234` `TOOL_DECISION_TREE` (recency-end, always injected), `AGENTS.md:559`, `agent/memory.md`
- **Action:** Expand `TOOL_DECISION_TREE` with 2 few-shot lines. Sync `AGENTS.md` `Memory Tool Usage` + subagent prompt with same verbose table + alias examples. No scope table per user.

## P3 — Strict Schemas + Validation Hints
- **File:** `src/plugin/tools.ts`, `src/plugin/hooks/tool-definition.ts`, `src/application/*` response hooks (already `phase5-response-hooks-complete NEXT:`)
- **Action:** `strict:true, additionalProperties:false, required` per alias/mode. Extend `NEXT:` hints: search 0 → try tagsFilter/rerank, fetch missing label → provide label, set without prior search → search first.

## Verification
- `bun run build && bun run lint 0/0`, `bun test 762 pass`, manual `memory_search(query="injection visibility")` hits `feat:injection-visibility-complete`, `memory_fetch(label="rule:mandatory:memory")` round-trips.

## Evaluation (per #3)
- After merge, track 7 days redundant calls, invalid param rate, 0-result search rate via `injection_metrics` — iterate descriptions if invalid >5% or redundant >20%.

## Non-Goals
- No scope change (stays project), no storage change.
