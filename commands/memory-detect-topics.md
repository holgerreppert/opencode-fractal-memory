---
description: Detect topic boundaries - group related memories into semantic clusters
---
Detect topic boundaries by grouping related memories into semantic clusters.

**When to use:**
- Find related memories
- Identify topic structure
- Organize memory into groups

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `min_similarity` (optional): 0-1, similarity threshold (default: 0.7)

**Usage:**
```
memory(mode="detect_topics", )
memory(mode="detect_topics", min_similarity=0.8)
memory(mode="detect_topics", scope="project")
```

**Output:**
Shows clusters of related memories with first 3 nodes each.

**Tips:**
- Lower min_similarity = more clusters
- Good for organizing memory
- Use after building up a memory corpus