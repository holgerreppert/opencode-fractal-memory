---
description: Mark a memory node as helpful (or not) and optionally adjust its usefulness score
---
Mark a memory node as helpful (or not) and optionally adjust its usefulness score.

**When to use:**
- After a memory helped you complete a task
- To improve search ranking for useful memories
- To penalize irrelevant or incorrect memories

**Arguments:**
- `id` OR `label` (one required): Which node to rate
- `scope` (optional): "global" or "project" (default: project)
- `helpful` (optional): true to increment timesHelpful counter
- `usefulness_score` (optional): 0-5, how helpful this memory was

**Usage:**
```
memory(mode="rate", label="rule:mandatory:memory", scope="global", helpful=true, usefulness_score=4)
memory(mode="rate", id="ab3f2", helpful=false)
memory(mode="rate", label="my-node", usefulness_score=5)
```

**How it works:**
- **usefulness_score**: Self-reported rating (0-5) of how useful the memory was
- **timesHelpful**: Counter incremented each time you mark memory as helpful
- **timesUsed**: Automatically incremented each time memory is returned in search

Higher scores improve future search ranking.
