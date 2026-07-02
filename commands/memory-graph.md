---
description: Build and query a code knowledge graph from AST extraction
---

Build a knowledge graph from the codebase using tree-sitter AST extraction. The graph captures symbols (functions, classes, interfaces, types) and their relationships (calls, imports, references) across 38+ languages.

**Commands:**

- `graph_build(root=".", max_files=5000)` — Run AST extraction + Louvain community detection on the project. Returns stats (files/symbols/edges/communities), god nodes (top 5 by degree), and a GRAPH_REPORT.md summary.

- `graph_search(query)` — Search graph nodes by symbol name or file path. Returns matching node IDs + metadata.

- `graph_path(from, to)` — Find the shortest directed path between two nodes by ID. Useful for understanding "what connects X to Y?"

- `graph_explain(id)` — Get full details on a node: attributes, degree, community, and all neighbors with their relationship types.

**Typical workflow:**
1. `graph_build()` — Build the graph once
2. `graph_search("UserService")` — Find the exact node IDs you care about
3. `graph_explain("file::src/services/user.ts")` — Explore a file's symbols
4. `graph_path("file::src/auth.ts", "file::src/db.ts")` — Trace dependencies

**About:**
- 38+ languages via tree-sitter WASM
- Edges: `calls` (function calls), `imports` (module deps), `defined_in` (symbol→file), `references` (type usage)
- Louvain community detection groups related code
- Graph persists in memory for the session; rebuild with `graph_build()` after code changes
- Accessible via MCP tools and management UI (POST /api/graph/build)
