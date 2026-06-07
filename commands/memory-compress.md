---
description: Compress memory nodes into summaries
---
Compress old memory nodes into higher-level summaries using fractal compression. Creates L1 summaries from L0 nodes then promotes them.

**Usage:**
```
memory_compress(scope="all", force=true)
memory_compress(scope="project")
```

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `force` (optional): true to bypass age check

**Compressed summaries have structured format:**
- **Decisions**: "decided", "chose", "will use"
- **Files**: modified/referenced (.ts, .py, .json, etc.)
- **Tools**: commands used (memory_*, git, npm, bun)
- **Patterns**: conventions, learnings
- **Topics**: section headings from sources
