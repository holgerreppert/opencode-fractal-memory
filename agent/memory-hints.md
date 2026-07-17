---
name: memory-hints
description: Memory system hints and best practices
---

# Memory System Guidelines

## CRITICAL: Memory-First Workflow
**ALWAYS** check memory before starting any task:
1. `memory(mode="search", query="relevant topic")` - find existing context
2. `memory(mode="drilldown_query", 'what do we know about X?')` - intent-based search
3. Use found context to inform your approach
4. If nothing found, proceed and store what you learn

## ⚡ MEMORY TRIGGER (Use THIS for quick lookup)
When you need to recall past context, use inline trigger in your response:
```
[[memory: your search query here]]
```

The plugin will automatically:
1. Detect the pattern in your output
2. Run memory(mode="search", query="...") with the query
3. Replace the [[memory: ...]] marker with search results
4. Track which memories were useful

Example:
```
Let me check what we know about deploying this plugin...
[[memory: how to deploy opencode plugin]]
```

**This is FASTER than calling memory(mode="search") - use this for quick lookups!**

## When to Create Memories (AUTO-STORE)

### After Reading Files
When you read a file to understand its purpose:
```
memory(mode="set", label="file:src/components/Auth.tsx", content="## Auth Component\n- Handles login/logout\n- Uses JWT tokens\n- Calls /api/auth endpoint", type="note")
```

### After Completing Tasks
After finishing significant work:
```
memory(mode="set", label="task:implement-auth-2026-03-30", content="## Auth Implementation\n- Decided to use JWT (not sessions)\n- Files: src/auth.ts, src/middleware.ts\n- Key decisions: 24h expiry, refresh tokens", type="event")
```

### After Finding Bugs/Workarounds
When you discover something non-obvious:
```
memory(mode="set", label="bug:sqlite-locking", content="## SQLite Locking Issue\n- Problem: concurrent writes fail\n- Solution: retry with exponential backoff\n- Location: src/storage/sqlite.ts:19-49", type="note")
```

### User Preferences
When you learn user preferences:
```
memory(mode="set", label="pref:code-style", content="## User Preferences\n- Prefers functional components\n- No emojis in code\n- Short variable names")
```

### Creating Skills (explicit)
Skills are auto-detectable instruction sets. Use `metadata` with triggers for keyword-based auto-loading:
```
memory(mode="set", label="skill:my-skill", content="## Skill Instructions\n...", type="skill", sticky=true, metadata='{"triggers":["keyword1","keyword2"]}')
```

## Memory Tools Reference

| Tool | When to use |
|------|-------------|
| `memory(mode="search", ...)` | Before starting any task |
| `memory(mode="set")` | After reading files, completing tasks, finding bugs |
| `memory(mode="get")` | When you need full details of a known node |
| `memory(mode="drilldown")` | When working with compressed summaries |
| `memory(mode="rate")` | After using memory to complete a task |
| `memory(mode="compress")` | When memory grows large (check with memory(mode="stats")) |

## Token Optimization
- Use `context(mode="check")` to monitor token usage
- Prefer `memory(mode="drilldown")` on L1+ nodes over raw L0 nodes
- Compress when context exceeds 60%

## Memory Labels Convention
- `file:path` - File summaries
- `task:description-date` - Task completions
- `bug:issue-name` - Bug workarounds
- `pref:category` - User preferences
- `decision:what-when` - Architecture decisions