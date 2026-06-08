---
description: Start the fractal memory MCP server for AI tool access
---
Start the MCP server for external AI tool access to the memory store.

The MCP server exposes 7 tools (memory_search, memory_get, memory_fetch, memory_list,
memory_stats, memory_set, memory_delete) and 2 resources (memory://stats/project,
memory://stats/global) via the Model Context Protocol over stdio.

The following tools accept an optional `project_name` argument to filter to a specific
project (defaults to the current project): memory_search, memory_list, memory_stats,
memory_set.

To configure in opencode.jsonc:
```jsonc
{
  "mcpServers": {
    "fractal-memory": {
      "command": "bun",
      "args": ["run", "PATH_TO_PLUGIN/dist/mcp-server.js"]
    }
  }
}
```
