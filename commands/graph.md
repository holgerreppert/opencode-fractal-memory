---
description: Navigate the code graph via AST symbols and call/import edges — 8 relations let you trace dependencies without reading files
---

Navigate code dependencies using a tree-sitter AST knowledge graph (38+ languages). The graph captures symbols (functions, classes, interfaces, types) and their relationships.

**Parameters:**
- `relation` (required): `callers`, `callees`, `call_chain`, `imports`, `dependents`, `search`, `explain`, `path`
- `name` — Symbol name (for callers/callees/call_chain)
- `file` — File path (for imports / dependents)
- `depth` — Max depth for call_chain (default 5)
- `query` — Search query for search relation
- `from` / `to` — Node IDs for path relation
- `id` — Node ID for explain relation
- `limit` — Max results (default 200 for callers/callees, 50 for search; omitted = no cap for other relations)

**Relations:**

| Relation | What it does | When to use |
|---|---|---|
| `callers` | Who calls this symbol | Before editing — check what depends on it |
| `callees` | What does this symbol call | After finding a symbol — trace its dependencies |
| `call_chain` | Transitive callers up to N depth | Impact analysis |
| `imports` | What modules/paths does this file import | Understanding a file's dependencies |
| `dependents` | What files import this module/path | Change impact analysis |
| `search` | Find graph nodes by name or file path | Finding symbols without reading files |
| `explain` | All neighbors of a graph node by ID | Full context around a node |
| `path` | Shortest path between two nodes by ID | Understanding indirect connections |

**Typical workflow:**
1. `graph(relation="search", query="MyClass")` — Find the exact node ID
2. `graph(relation="callers", name="myFunction")` — Check what depends on it before editing
3. `graph(relation="call_chain", name="myFunction", depth=3)` — Full transitive impact
4. `graph(relation="explain", id="file::src/services/user.ts")` — Explore a file's symbols

All results include a `truncated` field indicating if results were capped.
