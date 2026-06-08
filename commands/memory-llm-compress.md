---
description: Compress old memory nodes using LLM summarization - automatic AI-powered compression
---
Automatically compress old memory nodes using LLM summarization. Uses your configured OpenCode model.

**When to use:**
- Compress many old nodes at once
- Create semantic summaries via AI
- Reduce token usage

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `level` (optional): 0-3, which level to compress (default: 0)
- `dry_run` (optional): true to preview without compressing
- `force` (optional): true to bypass age check
- `project_name` (optional): Filter to a specific project (defaults to current project)

**Usage:**
```
memory_llm_compress()                    # Compress all level 0 nodes
memory_llm_compress(level=1)            # Compress level 1 nodes
memory_llm_compress(dry_run=true)     # Preview what would compress
memory_llm_compress(scope="project")   # Only project scope
```

**Compression levels:**
- Level 0 → 1: 7 days old
- Level 1 → 2: 30 days old
- Level 2 → 3: 90 days old
- Level 3 → 4: 180 days old

**Tips:**
- Use `dry_run=true` first to see candidates
- Compressed nodes keep parent links
- New summaries created at next level