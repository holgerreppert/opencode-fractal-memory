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
memory_delete(id="ab3f2")
memory_delete(label="outdated-decision")
```

**Tips:**
- Use `memory_get` first to verify correct node
- Deletion is permanent - no undo
- Consider using `memory_compress` instead to keep summary