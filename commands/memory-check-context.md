---
description: Check memory token usage
---
Check how much context my memory nodes are consuming. Use memory_check_context to show token usage vs the 128k limit and warn if approaching threshold. Useful for deciding when to compress.

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `project_name` (optional): Filter to a specific project (defaults to current project)
