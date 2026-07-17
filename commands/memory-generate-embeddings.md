---
description: Generate embeddings for nodes without them - enables semantic search
---
Generate embeddings for memory nodes that don't have them. Enables semantic search and similarity-based compression.

**When to use:**
- After importing nodes without embeddings
- Fix nodes that failed embedding generation
- Enable similarity search

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: project)
- `level` (optional): Only generate for this level
- `dry_run` (optional): true to preview without generating

**Usage:**
```
memory(mode="generate_embeddings", )
memory(mode="generate_embeddings", dry_run=true)
memory(mode="generate_embeddings", scope="global")
```

**Tips:**
- Use `dry_run=true` first to see candidates
- Takes a while for large memory corpora
- Failed nodes logged in console