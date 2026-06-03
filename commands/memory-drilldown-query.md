---
description: Top-down drilldown query - start from summaries, get specific details
---
Top-down drilldown from high-level summaries to specific details.

**When to use:**
- Explore memory hierarchically
- Start broad, go specific
- Navigate memory structure

**Arguments:**
- `query` (required): Your question or intent
- `max_results` (optional): Max results (default: 20)

**Usage:**
```
memory_drilldown_query("How does auth work?")
memory_drilldown_query("What decisions were made?", max_results=10)
```

**How it works:**
1. Searches high-level summaries first
2. Follows parent links to lower-level details
3. Returns hierarchical results

**Tips:**
- Good for exploration
- Use with memory_search for direct lookup