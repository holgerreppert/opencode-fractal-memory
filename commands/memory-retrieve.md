---
description: Retrieve memory nodes as JSON - programmatic access to search results
---
Retrieve raw memory nodes as JSON for programmatic consumption. Returns array of node objects.

**When to use:**
- Process memory results in scripts
- Access multiple fields (id, label, level, importance)
- Integrate with external tools

**Arguments:**
- `query` (required): Search query
- `limit` (optional): Max nodes to return (default: 10)
- `min_level` (optional): Minimum compression level (0=raw)
- `max_level` (optional): Maximum compression level
- `bm25_weight` (optional): 0-1, keyword vs semantic weight (default: 0.4)
- `query_text` (optional): Explicit query text for BM25

**Usage:**
```
memory(mode="search", "authentication")
memory(mode="search", "auth", limit=5)
memory(mode="search", "session", min_level=0, max_level=1)
memory(mode="search", "bug", bm25_weight=0.8)  # More keyword-focused
```

**Returns:**
```json
[{"id":"...","label":"...","scope":"project","level":0,"content":"...","importance":0.8}]
```

**Tips:**
- Use for automation/scripts
- Check memory(mode="search", ...) first for human-readable results