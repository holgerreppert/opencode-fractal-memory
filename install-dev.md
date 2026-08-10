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

## Install locally (development) — use the dev-install script

ALWAYS use `scripts/dev-install.ts` — it syncs the plugin cache that OpenCode actually loads. The manual `cp -r` ritual it replaces was the root cause of the 2026-08-06 stale-cache bug (cache stayed 0.7.13 while 0.7.14 was published).

```bash
bun run dev-install                # build + clean + sync to ~/.config/opencode + plugin cache
bun run dev-install --skip-build   # skip tsc, just sync
```

What the script does:
1. Runs `bun run build` (unless `--skip-build`)
2. Wipes `~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/` (the ONLY location OpenCode loads — beacon-proven via `PLUGIN_LOADED_FROM` in `~/.config/opencode/logs/memory-plugin.log`; the legacy `~/.config/opencode/node_modules` copy is also cleaned for npm-pack compat, but is never read by OpenCode)
3. Copies ALL top-level files into the cache: `dist management package.json LICENSE README.md commands agent scripts`
4. Copies runtime deps into the cache location's own `node_modules/`: graphology family, `@kreuzberg/tree-sitter-language-pack-wasm`, onnxruntime, events, pandemonium, `@yomguithereal/helpers`, mnemonist, obliterator
5. Prints the installed version + a RESTART REQUIRED warning; exits non-zero if `dist` is missing from the cache

VS Code: use the "Dev Install Plugin (build+clean+sync)" launch config in `.vscode/launch.json`.

## Why two locations

OpenCode loads the plugin from the **cache** dir (`~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/`), NOT from `~/.config/opencode/node_modules`. A plain `npm install`/`npm pack` only touches the latter and leaves the loaded copy stale — the cache copy must be synced by hand (or by the script).

## Iterate on changes

```bash
cd /path/to/opencode-fractal-memory
bun run dev-install     # rebuilds, syncs the plugin cache OpenCode actually loads
# Restart OpenCode to load the updated plugin
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

Or verify the cache copy matches the repo version:

```bash
grep '"version"' ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/package.json
```

## Direct install from npm (non-development)

```bash
cd ~/.config/opencode
rm -rf node_modules/opencode-fractal-memory package-lock.json
npm install --ignore-scripts opencode-fractal-memory
```

For published releases, refresh the cache pin after publish:
```bash
cd ~/.cache/opencode/packages/opencode-fractal-memory@latest
rm -rf node_modules bun.lock package.json
echo '{"dependencies":{}}' > package.json
bun add opencode-fractal-memory@latest
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
