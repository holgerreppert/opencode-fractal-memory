---
description: Rate injected memories - upvote helpful, downvote irrelevant
---
Rate the usefulness of injected memories after completing a task. Helps improve future injection relevance.

**When to use:**
- After a task using injected memory
- Filter good vs irrelevant injections
- Improve memory system

**Arguments:**
- `session_id` (required): From context(mode="injection_stats")
- `upvotes` (optional): Number of helpful injections (default: 0)
- `downvotes` (optional): Number of irrelevant injections (default: 0)
- `task_outcome` (optional): "success", "partial", or "failed"
- `needed_nodes` (optional): Labels that would have helped but weren't injected

**Usage:**
```
context(mode="injection_feedback", session_id="abc123", upvotes=3, downvotes=1, task_outcome="success")
context(mode="injection_feedback", session_id="abc123", upvotes=0, downvotes=2, task_outcome="partial")
```

**Tips:**
- Use `context(mode="injection_stats")` to find session IDs
- Helps the system learn what memories are useful