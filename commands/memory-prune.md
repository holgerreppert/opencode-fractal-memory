---
description: Find and prune stale/unused memory nodes
---
Find and prune stale/unused memory nodes. By default runs in dry-run mode (shows what would be pruned).

**Usage:**
```
memory_prune()
memory_prune(dryRun=false)
memory_prune(scope="project", maxAgeDays=30, dryRun=false)
```

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `dryRun` (optional): false to actually delete nodes (default: true)
- `minAccessCount` (optional): Minimum accesses to keep (default: 0)
- `maxAgeDays` (optional): Max age in days (default: 90)
- `minImportance` (optional): Minimum importance to keep (default: 0)
- `excludeSticky` (optional): Skip sticky nodes (default: true)
- `excludeCore` (optional): Skip core label nodes (default: true)
