---
description: List all memory nodes
---
List all my memory nodes across all scopes. Shows labels, levels, importance, and types.

**Usage:**
```
memory_list()
memory_list(scope="all")
memory_list(scope="project", level=0)
```

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `level` (optional): Only list nodes at this level
- `project_name` (optional): Filter to a specific project (if omitted, searches both global and project scopes)
