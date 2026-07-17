---
description: Find and prune stale/unused memory nodes
---
Find and prune stale/unused memory nodes. By default runs in dry-run mode (shows what would be pruned).

**Usage:**
```
memory(mode="prune", )
memory(mode="prune", dryRun=false)
memory(mode="prune", scope="project", maxAgeDays=30, dryRun=false)
```

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `dryRun` (optional): false to actually delete nodes (default: true)
- `minAccessCount` (optional): Minimum accesses to keep (default: 0)
- `maxAgeDays` (optional): Max age in days (default: 90)
- `minImportance` (optional): Minimum importance to keep (default: 0)
- `excludeSticky` (optional): Skip sticky nodes (default: true)
- `excludeCore` (optional): Skip core label nodes (default: true)
- `project_name` (optional): Filter to a specific project (if omitted, searches both global and project scopes)
