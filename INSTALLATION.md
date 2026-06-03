# opencode-fractal-memory Installation Guide

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **OpenCode** | v1.15.13+ | SDK peer dependency |
| **Bun** | >=1.0.0 | Plugin runtime |
| **Node.js** | >=18 | For npm-based installs only |

## Installation

### For OpenCode users (recommended)

Add the plugin name to your `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["opencode-fractal-memory"]
}
```

OpenCode automatically installs npm plugins via `bun install` at startup. The model files (~24 MB) download automatically on first plugin load — no manual steps needed.

### For development / manual install

Build from source or install a `.tgz`:

```bash
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts ./path/to/opencode-fractal-memory-0.2.0.tgz
```

Use `--ignore-scripts` to avoid Bun trust prompts. Models download on first plugin load instead.

## How model download works

OpenCode uses `bun install` at startup, which **skips lifecycle scripts** (`postinstall`) by default. To handle this, the plugin downloads model files during its initialization phase:

1. User adds plugin to `opencode.json` → OpenCode runs `bun install`
2. Plugin installs (postinstall skipped) → OpenCode loads the plugin via `import()`
3. Plugin init calls `ensureModels()` → checks `~/.config/opencode/models/`
4. If model files are missing, downloads from HuggingFace (quantized ONNX + tokenizer, ~24 MB total)
5. Files land at `~/.config/opencode/models/Xenova/all-MiniLM-L6-v2/`

The `postinstall` script in `package.json` is a fallback for manual `npm install` (where lifecycle scripts do run) and for environments like CI.

## MCP server setup

For IDE integration via the Model Context Protocol:

```json
{
  "mcp": {
    "fractal-memory": {
      "type": "local",
      "command": ["bun", "run", "<path-to-plugin>/dist/mcp-server.js"],
      "enabled": true
    }
  }
}
```

Replace `<path-to-plugin>` with the actual install path (e.g., `~/.config/opencode/node_modules/opencode-fractal-memory`).

## Verify Installation

Check that the plugin loaded:

```bash
tail -f ~/.config/opencode/memory.log
```

You should see initialization messages like:
```
[INFO] MemoryPlugin: Initialized in <X>ms
[INFO] MemoryPlugin: Seed nodes ensured
[INFO] MemoryPlugin: Loaded <N> rule nodes
```

## Post-Installation

### First Run
On first startup, the plugin automatically creates seed nodes:
- `rule:mandatory:memory` - Critical memory rules
- `rule:mandatory:core` - System explanation
- `rule:standard` - Workflow patterns
- `rule:suggestion` - Optimization tips
- `persona` - Communication style
- `memory-quick-start` - Quick reference

And 6 built-in playbooks and 9 skills as memory nodes.

### Access Memory Commands
Type `/memory-` in OpenCode to see available commands:
- `/memory-stats` - View memory statistics
- `/memory-list` - List all nodes
- `/memory-search` - Semantic search
- `/memory-drilldown` - Fractal retrieval
- And more...

## Troubleshooting

### Plugin Not Loading
1. Check OpenCode config has correct JSON syntax
2. Verify bun is installed: `bun --version`
3. Check logs: `tail ~/.config/opencode/memory.log`

### Model Download Fails
The plugin uses HuggingFace CDN. If downloads fail:
```bash
# Run manually to see errors
bun run ~/.config/opencode/node_modules/opencode-fractal-memory/scripts/download-models.ts
```

### Database Errors
If you see SQLite errors, delete the database and restart:
```bash
rm ~/.config/opencode/memory.db
# Restart OpenCode
```

## Uninstallation

```bash
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory
rm ~/.config/opencode/memory.db
# Remove from opencode.json plugins array
```

## Next Steps

See [QUICK_START.md](./QUICK_START.md) for basic usage patterns.
