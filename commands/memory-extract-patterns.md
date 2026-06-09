---
description: Extract cross-layer patterns from memory nodes
---
Extract cross-layer patterns from memory nodes using memory_extract_patterns. This tool finds recurring decisions, preferences, conventions, tools, and files across diverse topics and creates a pattern summary node at L1. Use this to distill learnings from multiple different projects or sessions into consolidated knowledge.

**Arguments:**
- `scope` (optional): "all", "global", or "project" (default: all)
- `min_source_count` (optional): Minimum sources for a pattern (default: 2)
- `project_name` (optional): Filter to a specific project (if omitted, searches both global and project scopes)
