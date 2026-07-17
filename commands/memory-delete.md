---
description: Delete a memory node by ID or label - use with caution
---
Delete a memory node. Use with caution - deletion is permanent.

**When to use:**
- Remove outdated or incorrect memories
- Clean up duplicate entries
- Delete test/temporary nodes

**Arguments:**
- `id` OR `label` (one required): Which node to delete
- `scope` (optional): "global" or "project"

**Usage:**
```
memory(mode="delete", id="ab3f2")
memory(mode="delete", label="outdated-decision")
```

**Tips:**
- Use `memory(mode="get")` first to verify correct node
- Deletion is permanent - no undo
- Consider using `memory(mode="compress")` instead to keep summary