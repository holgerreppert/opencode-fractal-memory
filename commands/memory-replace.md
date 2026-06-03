---
description: Replace content in a memory node - edit without rewriting full node
---
Replace specific text in a memory node. Good for small edits without rewriting the entire node.

**When to use:**
- Fix typos in stored memories
- Update a detail without replacing full content
- Fix outdated information

**Arguments:**
- `id` OR `label` (one required): Which node to edit
- `oldText`: Exact text to replace
- `newText`: Replacement text
- `scope` (optional): "global" or "project"

**Usage:**
```
memory_replace(id="ab3f2", oldText="Chose Supabase", newText="Chose Clerk")
memory_replace(label="auth-choice", oldText="v1", newText="v2")
```

**Tips:**
- Use `memory_get` first to see exact text
- Supports fuzzy whitespace matching
- Best for targeted fixes, not full rewrites