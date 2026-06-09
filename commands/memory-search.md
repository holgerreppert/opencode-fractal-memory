---
description: Search memory for relevant context - call when you need past decisions, patterns, or information
---
Search your memory for relevant context. Call this tool when you need to recall:
- Past decisions and why they were made
- Patterns that worked or failed
- User preferences and conventions
- Bug workarounds and solutions

**How it works:**
- Provide keywords describing what you're looking for
- Search uses semantic similarity + keyword matching (BM25)
- Returns distilled summaries ranked by relevance
- Follows memory links to related nodes

**Usage:**
```
memory_search("authentication implementation patterns")
memory_search("SQLite concurrency issues")
memory_search("user prefers", bm25_weight=0.6)  # More keyword-focused
```

**Tips:**
- Use specific terms: "session tracking" > "stuff we did"
- Check summary content first, drill down with `memory_drilldown` for full details
- Memory nodes have levels: L0=raw, L1=summaries - use min_level to filter
- **After using memory**: The system auto-rates useful memories after successful edits
- **Filter by usefulness**: Use `min_usefulness` to only show high-rated memories (0-5)
- **Filter by project**: Use `project_name` to scope search to a specific project (if omitted, searches both global and project scopes)
