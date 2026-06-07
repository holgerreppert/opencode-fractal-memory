---
name: memory-hints
description: Memory system hints and best practices
---

# Memory System Guidelines

## CRITICAL: Memory-First Workflow
**ALWAYS** check memory before starting any task:
1. `memory_search('relevant topic')` - find existing context
2. `memory_drilldown_query('what do we know about X?')` - intent-based search
3. Use found context to inform your approach
4. If nothing found, proceed and store what you learn

## ⚡ MEMORY TRIGGER (Use THIS for quick lookup)
When you need to recall past context, use inline trigger in your response:
```
[[memory: your search query here]]
```

The plugin will automatically:
1. Detect the pattern in your output
2. Run memory_search with the query
3. Replace the [[memory: ...]] marker with search results
4. Track which memories were useful

Example:
```
Let me check what we know about deploying this plugin...
[[memory: how to deploy opencode plugin]]
```

**This is FASTER than calling memory_search tool - use this for quick lookups!**

## When to Create Memories (AUTO-STORE)

### After Reading Files
When you read a file to understand its purpose:
```
memory_set {
  label: "file:src/components/Auth.tsx",
  content: "## Auth Component\n- Handles login/logout\n- Uses JWT tokens\n- Calls /api/auth endpoint",
  type: "knowledge"
}
```

### After Completing Tasks
After finishing significant work:
```
memory_set {
  label: "task:implement-auth-2026-03-30",
  content: "## Auth Implementation\n- Decided to use JWT (not sessions)\n- Files: src/auth.ts, src/middleware.ts\n- Key decisions: 24h expiry, refresh tokens",
  type: "session"
}
```

### After Finding Bugs/Workarounds
When you discover something non-obvious:
```
memory_set {
  label: "bug:sqlite-locking",
  content: "## SQLite Locking Issue\n- Problem: concurrent writes fail\n- Solution: retry with exponential backoff\n- Location: src/storage/sqlite.ts:19-49",
  type: "lesson"
}
```

### User Preferences
When you learn user preferences:
```
memory_set {
  label: "pref:code-style",
  content: "## User Preferences\n- Prefers functional components\n- No emojis in code\n- Short variable names",
  type: "preference"
}
```

### Creating Skills (explicit)
Skills are auto-detectable instruction sets. Use `metadata` with triggers for keyword-based auto-loading:
```
memory_set {
  label: "skill:my-skill",
  content: "## Skill Instructions\n...",
  type: "skill",
  sticky: true,
  metadata: '{"triggers":["keyword1","keyword2"]}'
}
```

## Memory Tools Reference

| Tool | When to use |
|------|-------------|
| `memory_search` | Before starting any task |
| `memory_set` | After reading files, completing tasks, finding bugs |
| `memory_get` | When you need full details of a known node |
| `memory_drilldown` | When working with compressed summaries |
| `memory_rate` | After using memory to complete a task |
| `memory_compress` | When memory grows large (check with memory_stats) |

## Token Optimization
- Use `memory_check_context` to monitor token usage
- Prefer `memory_drilldown` on L1+ nodes over raw L0 nodes
- Compress when context exceeds 60%

## Memory Labels Convention
- `file:path` - File summaries
- `task:description-date` - Task completions
- `bug:issue-name` - Bug workarounds
- `pref:category` - User preferences
- `decision:what-when` - Architecture decisions