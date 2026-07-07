# Changelog

## 0.7.0 — 2026-07-07

### Context Quality Layer Improvements (P0–P2)

- **Layer 1: Context Quality**: Tool call dedup (LRU cache, turn-protected), error input pruning (replaces failed tool args), structured memory injection (XML `<memory_context>` blocks), cross-session context injection (storedcontext summaries), adaptive rule selection (keyword-overlap scoring)
- **Layer 2: Progressive Rule Disclosure**: Strips non-essential rules at context pressure thresholds (>75%/85%/95%), proactive compaction nudges
- **Layer 3: Structured Summaries**: YAML headers on storedcontext nodes with tools, files, errors, token usage, turn count
- **Layer 4–5: Structural Shapes**: 4 new output-type detectors (compiler-diagnostics, test-output, npm-install, coverage-log) with tailored compressors; `compressByType` delegation in generic strategies
- **Management UI**: New "Context Quality" settings category with toolDedup + errorPruning toggles
- **Testing**: 37 new tests (tool-dedup, session-cache, error-prune, messages-transform, tool-dedup-handler); 108 total, 0 lint
