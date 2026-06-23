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

After building, pack and install into the OpenCode config directory, then copy to cache:

```bash
# Create the .tgz archive
npm pack

# Install into OpenCode
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts /path/to/opencode-fractal-memory-0.6.32.tgz

# Also copy to OpenCode's plugin cache (required — npm install doesn't populate this)
cp -r node_modules/opencode-fractal-memory/dist \
  node_modules/opencode-fractal-memory/management \
  node_modules/opencode-fractal-memory/package.json \
  node_modules/opencode-fractal-memory/LICENSE \
  node_modules/opencode-fractal-memory/commands \
  node_modules/opencode-fractal-memory/agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

Use `--ignore-scripts` to avoid Bun trust prompts (npm v12 defaults to this behavior, making it the standard). Models download on first plugin load instead.

## Iterate on changes

After making code changes:

```bash
# 1. Rebuild and pack
cd /path/to/opencode-fractal-memory
bun run build
npm pack

# 2. Reinstall in OpenCode
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts /path/to/opencode-fractal-memory-0.6.32.tgz

# 3. Copy to plugin cache (npm install does NOT populate this automatically)
cp -r node_modules/opencode-fractal-memory/dist \
  node_modules/opencode-fractal-memory/management \
  node_modules/opencode-fractal-memory/package.json \
  node_modules/opencode-fractal-memory/LICENSE \
  node_modules/opencode-fractal-memory/commands \
  node_modules/opencode-fractal-memory/agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/

# 4. Restart OpenCode to load the updated plugin
```

### Quick iteration (cp to cache only)

For small changes that don't affect `package.json`, skip the npm install and copy directly:

```bash
bun run build
cp -r dist management package.json LICENSE README.md commands agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

OpenCode loads from the cache, so this is sufficient for most changes. Restart OpenCode to see the update.

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
- File summarization log: `~/.config/opencode/logs/filesum.log`
- Command compression log: `~/.config/opencode/logs/compress.log`
- Session log: `~/.config/opencode/logs/sessionlog.log`
- Database: `~/.config/opencode/memory.db` (unified — global + project nodes)
- Models cache: `~/.config/opencode/models/Xenova/all-MiniLM-L6-v2/`
