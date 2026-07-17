---
description: Analyze session failures to create lesson nodes - learn from mistakes
---
Analyze a session to create lesson nodes from tool failures. Call after session ends to learn from mistakes.

**When to use:**
- After a session with failures
- To create reusable lessons
- Before memory(mode="distill")

**Arguments:**
- `session_id` (optional): Session to analyze (defaults to current)
- `dry_run` (optional): true to preview without creating nodes
- `use_llm` (optional): true for LLM-enhanced analysis

**Usage:**
```
memory(mode="reflect", )
memory(mode="reflect", session_id="abc123")
memory(mode="reflect", dry_run=true)
```

**Output:**
- Session summary (status, total calls, failed calls)
- Failed tool analysis with patterns
- Files with failures
- Generated lessons

**Lesson patterns:**
- `memory(mode="drilldown")` → "use memory(mode="search") first"
- `memory(mode="get")` → "verify label exists"
- `read/glob` → "check file exists"
- `edit` → "read file first"

**Tips:**
- Creates `lesson:<timestamp>` nodes
- Use with memory(mode="distill") to create rules