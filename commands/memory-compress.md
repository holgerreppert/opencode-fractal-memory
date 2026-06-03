---
description: Compress memory nodes into summaries
---
Compress old memory nodes into higher-level summaries using fractal compression. Use memory_compress with scope="all" and force=true to create L1 summaries from L0 nodes. Shows how many nodes were compressed and how many summaries were created.

Compressed summaries have structured format:
- **Decisions**: "decided", "chose", "will use"
- **Files**: modified/referenced (.ts, .py, .json, etc.)
- **Tools**: commands used (memory_*, git, npm, bun)
- **Patterns**: conventions, learnings
- **Topics**: section headings from sources

Example: Run /memory-compress with force=true to compress all eligible nodes now.
