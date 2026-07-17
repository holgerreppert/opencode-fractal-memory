---
description: Get a memory node by ID or label - retrieve full content
---
Get the full content of a memory node. Use after `memory(mode="search", ...)` finds relevant nodes.

**When to use:**
- Retrieve full details from a node found via search
- Inspect a specific memory's content
- Check memory properties (level, type, importance)

**Arguments:**
- `id` (optional): Node ID or prefix (e.g., "ab3f2")
- `label` (optional): Node label (e.g., "auth-choice-supabase")
- `scope` (optional): "global" or "project"

**Usage:**
```
memory(mode="get", id="ab3f2")
memory(mode="get", label="auth-choice-supabase")
memory(mode="get", "ab3f2")  # shorthand
```

**Tips:**
- Use label for cleaner access, ID for exact matches
- Prefix matching works (first 8 chars usually enough)
- Check properties to understand node's importance/type
- Metadata section shown when present (e.g., skill triggers)