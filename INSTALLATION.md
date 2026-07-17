# opencode-fractal-memory Installation Guide

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **OpenCode** | v1.17.0+ | SDK peer dependency |
| **Bun** | >=1.0.0 | Plugin runtime |
| **Node.js** | >=18 | For npm-based installs only |

## Installation

### For OpenCode users (recommended)

Add the plugin name to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-fractal-memory"]
}
```

OpenCode automatically installs npm plugins via `bun install` at startup. The model files (~24 MB) download automatically on first plugin load — no manual steps needed.

### For development / manual install

Build from source or install a `.tgz`:

```bash
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts ./path/to/opencode-fractal-memory-0.7.6.tgz
```

Use `--ignore-scripts` to avoid Bun trust prompts (npm v12 defaults to this behavior). Models download on first plugin load instead.

### Quick iteration (cp method)

After rebuilding, copy directly to the cached plugin directory:

```bash
cd /path/to/opencode-fractal-memory
bun run build
cp -r dist management package.json LICENSE README.md commands agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

This also updates the command files. Restart OpenCode to load the changes.

### If the cache stays stale

OpenCode's bun-managed cache can pin an old version. To force a refresh:

```bash
rm -rf ~/.bun/install/cache/
cd ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
bun add opencode-fractal-memory@latest
```

Or copy the build directly as described above.

This is a known OpenCode issue: [#6774](https://github.com/anomalyco/opencode/issues/6774), [#25293](https://github.com/anomalyco/opencode/issues/25293).

## How model download works

OpenCode uses `bun install` at startup, which **skips lifecycle scripts** (`postinstall`) by default. To handle this, the plugin downloads model files during its initialization phase:

1. User adds plugin to `opencode.json` → OpenCode runs `bun install`
2. Plugin installs (postinstall skipped) → OpenCode loads the plugin via `import()`
3. Plugin init calls `ensureModels()` → checks `~/.config/opencode/models/`
4. If model files are missing, downloads from HuggingFace (quantized ONNX + tokenizer, ~24 MB total)
5. Files land at `~/.config/opencode/models/Xenova/all-MiniLM-L6-v2/`

The `postinstall` script in `package.json` is a fallback for manual `npm install` (where lifecycle scripts do run) and for environments like CI.

## Command files

The plugin ships markdown command files (e.g., `/memory-set`, `/memory-get`) from `commands/`. They are copied to `~/.config/opencode/commands/` on plugin init by `ensureCommandFiles()`. After updating command files, either restart OpenCode or copy them manually:

```bash
cp commands/*.md ~/.config/opencode/commands/
```

## MCP server setup

For IDE integration via the Model Context Protocol:

```json
{
  "mcp": {
    "fractal-memory": {
      "type": "local",
      "command": ["bun", "run", "<cache-path>/dist/mcp-server.js"],
      "enabled": true
    }
  }
}
```

Replace `<cache-path>` with the actual install path (e.g., `~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory`).

## Transfer sessions between machines

Export a session to a local JSON file (no server involved):

```bash
opencode export <sessionID> --sanitize
```

Import on another machine:

```bash
opencode import session.json
```

List available sessions with `opencode session list`.

## Verify Installation

Check that the plugin loaded:

```bash
tail -f ~/.config/opencode/logs/memory-plugin.log
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

### Creating Custom Skills
Skills are memory nodes with `type="skill"` and `metadata.triggers`. They auto-load when trigger keywords appear:

```
memory(mode="set", content="## Skill content...", label="skill:my-skill", type="skill", metadata='{"triggers":["keyword1","keyword2"]}', sticky=true)
```

## Troubleshooting

### Plugin Not Loading
1. Check OpenCode config has correct JSON syntax
2. Verify bun is installed: `bun --version`
3. Check logs: `tail ~/.config/opencode/logs/memory-plugin.log`

### Model Download Fails
The plugin uses HuggingFace CDN. If downloads fail:
```bash
bun run ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/scripts/download-models.ts
```

### Database Errors
If you see SQLite errors, delete the database and restart:
```bash
rm ~/.config/opencode/memory.db
# Restart OpenCode
```

## Uninstallation

```bash
# Remove from opencode.json plugins array first
rm -rf ~/.config/opencode/node_modules/opencode-fractal-memory
rm -rf ~/.cache/opencode/packages/opencode-fractal-memory@latest
rm ~/.config/opencode/memory.db
```

## Next Steps

See [QUICK_START.md](./QUICK_START.md) for basic usage patterns.
