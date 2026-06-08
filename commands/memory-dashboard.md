---
description: Display memory dashboard with top nodes by usefulness, type distribution, and recent activity
---
Display the memory dashboard showing:

1. **Top nodes by access count** - Which memories are used most
2. **Type distribution** - Breakdown by type (note, core, summary, etc.)
3. **Compression health** - Tree depth, fractal dimension, embedding coverage
4. **Usefulness tracking** - timesUsed, usefulnessScore for top nodes

Useful for understanding what's in memory and identifying compression opportunities.

**Usage:**
```
memory_dashboard
memory_dashboard { scope: "project", limit: 20 }
```

**Arguments:**
- `scope`: "all" | "global" | "project" (default: "all")
- `limit`: Number of top nodes to show (default: 10)
- `show_tree_depth`: boolean – include the tree‑depth line in the Compression Health section (default: true)
- `show_embedding_coverage`: boolean – include the “Nodes with embeddings” line (default: true)
- `project_name`: Filter to a specific project (defaults to current project)