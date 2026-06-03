---
description: Generate a prompt to summarize a memory node via LLM - manual summary creation
---
Generate an LLM prompt to summarize a memory node. Use this before creating a manual summary.

**When to use:**
- Prepare better summaries before compression
- Get help summarizing complex memories
- Manual summary creation workflow

**Arguments:**
- `id` OR `label` (one required): Which node to summarize
- `scope` (optional): "global" or "project"

**Usage:**
```
memory_summarize(id="ab3f2")
memory_summarize(label="auth-choice")
```

**Output:**
Returns a prompt you can paste into an LLM. After getting the summary, create a new node:
```
memory_set(content="<summary>", type="summary", level=1, parent_ids="ab3f2")
```

**Tips:**
- Use level=1 for summaries of level=0 nodes
- Include parent_ids to link back to original