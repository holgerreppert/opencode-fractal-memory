# Development Installation Guide

Build and install `opencode-fractal-memory` from source for local development.

## Prerequisites

- **Bun** >=1.0.0
- **Node.js** >=18
- **OpenCode** v1.15.13+

## Build from source

```bash
# Clone the repo
git clone https://github.com/holgerreppert/opencode-fractal-memory.git
cd opencode-fractal-memory

# Install dependencies
bun install

# Build TypeScript
bun run build
```

## Install locally (development)

After building, pack and install into the OpenCode config directory:

```bash
# Create the .tgz archive
npm pack

# Install into OpenCode
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts /path/to/opencode-fractal-memory-0.6.10.tgz
```

Use `--ignore-scripts` to avoid Bun trust prompts. Models download on first plugin load instead.

## Iterate on changes

After making code changes:

```bash
# 1. Rebuild
cd /path/to/opencode-fractal-memory
bun run build
npm pack

# 2. Reinstall in OpenCode
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts /path/to/opencode-fractal-memory-0.6.10.tgz

# 3. Restart OpenCode to load the updated plugin
```

## Verify

Check that the plugin loaded:

```bash
tail -f ~/.config/opencode/logs/memory-plugin.log
```

Look for:
```
[INFO] MemoryPlugin: Initialized in <X>ms
[INFO] MemoryPlugin: Seed nodes ensured
```

## Direct install from npm (non-development)

```bash
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts opencode-fractal-memory
```

## Logs

- Main log: `~/.local/share/opencode/log/`
- Plugin log: `~/.config/opencode/logs/memory-plugin.log`
- MCP server log: `~/.config/opencode/logs/mcp-server.log`
- Database: `~/.config/opencode/memory.db` (unified — global + project nodes)
- Models cache: `~/.config/opencode/models/Xenova/all-MiniLM-L6-v2/`
