---
description: Create or update a memory node - store decisions, preferences, lessons learned
---
Create or update a memory node. Use to store important information that you want to retrieve later.

**When to use:**
- Store architecture decisions ("Chose X because Y")
- Save user preferences ("User prefers concise responses")
- Record lessons learned ("Package Y needs --legacy-peer-deps")
- Remember bug workarounds

**Arguments:**
- `content` (required): The memory content
- `label` (optional): Human-readable label, e.g., "auth-decision"
- `scope` (optional): "global" or "project" (default: project)
- `summary` (optional): Brief summary for search results
- `type` (optional): "event", "episode", "concept", "summary", "core", "note"
- `sticky` (optional): true to prevent compression
- `importance` (optional): 0-1, higher = more important
- `usefulness_score` (optional): Rate how helpful (0-5)

**Usage:**
```
memory_set("Chose Supabase for auth because it provides social login + built-in user management", label="auth-choice-supabase", type="event", importance=0.8)
memory_set("Remember: User prefers inline code explanations over comments", label="user-pref-concise", sticky=true)
```

**Tips:**
- Use `sticky=true` for critical rules that must survive compression
- Rate memories with `usefulness_score` after successful retrieval
- Link related nodes with `parent_ids`