---
description: Compress memory nodes into summaries
---
Compress old memory nodes into higher-level summaries using fractal compression. Creates L1 summaries from L0 nodes then promotes them.

**Usage:**
```
memory(mode="compress", scope="all", force=true)
memory(mode="compress", scope="project")
```

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `force` (optional): true to bypass age check
- `project_name` (optional): Filter to a specific project (if omitted, searches both global and project scopes)

**Compressed summaries have structured format:**
- **Decisions**: "decided", "chose", "will use"
- **Files**: modified/referenced (.ts, .py, .json, etc.)
- **Tools**: commands used (memory(mode=...), git, npm, bun)
- **Patterns**: conventions, learnings
- **Topics**: section headings from sources
