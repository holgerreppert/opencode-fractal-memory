---
description: Extract actionable rules from lesson nodes - update rule:mandatory nodes
---
Extract actionable rules from recent lesson nodes and update rule:mandatory nodes.

**When to use:**
- After memory(mode="reflect") created lessons
- To turn failures into rules
- Update behavioral rules

**Arguments:**
- `dry_run` (optional): true to preview without applying
- `use_llm` (optional): true for LLM-enhanced rules

**Usage:**
```
memory(mode="distill", )
memory(mode="distill", dry_run=true)
memory(mode="distill", use_llm=true)
```

**How it works:**
1. Finds recent lesson nodes
2. Extracts unique fixes
3. Deduplicates and refines
4. Updates rule:mandatory nodes

**Output:**
- List of rules to add/update
- Confirmation after applying

**Tips:**
- Run memory(mode="reflect") first to create lessons
- Use `use_llm=true` for better rules
- Rules apply next session