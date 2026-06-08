---
description: Show fractal memory statistics
---
Show me my memory stats including:
- Nodes per level (L0-L4 hierarchy)
- Compression ratios and fractal dimension
- Tree depth and children per node
- HNSW index stats (nodes indexed, dimension)
- Storage info (binary embeddings vs JSON)

Use memory_stats with scope="all".

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `project_name` (optional): Filter to a specific project (defaults to current project)
