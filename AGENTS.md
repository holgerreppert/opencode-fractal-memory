# opencode-fractal-memory

Plugin providing infinite context memory for OpenCode via SQLite, embeddings, and BM25 hybrid search.

## Architecture

- **Storage**: SQLite (`~/.config/opencode/memory.db`), sqlite-vec (cosine sim), FTS5 (BM25)
- **Hooks**: `tool.execute.before` (file summarization), `tool.execute.after` (memory + compression), `experimental.chat.system.transform` (rule injection), `event` (lifecycle)
- **Management app**: Served on `http://localhost:8787`, spawned as subprocess. HTML at `management/public/`, API routes at `src/management/routes.ts`
- **Config**: `~/.config/opencode/opencode-mem.json`, validated with Zod schema (src/config.ts)

## Command Output Compression (`commandCompression`)

Built-in, zero-dependency compression in `tool.execute.after` for bash commands. Strategies:

- `ls` → tree summary (dir/file counts)
- Test runners (npm test, bun test, pytest, etc.) → pass/fail summary + failures
- `grep`/`rg` → group by file with match counts
- `git status` → branch + staged/unstaged counts
- `git log` → one-line per commit
- `git diff` → N files changed, +M -L
- Generic fallback → dedup + truncate at maxLines (default 50)
- Full output preserved on non-zero exit ("tee mode")

Stats recorded to `compression_stats` table. View at management app → Compress tab.

## Development Install (critical — cache or it won't work)

OpenCode loads from plugin cache, NOT from node_modules. Both steps required:

```bash
bun run build         # compile TS
npm pack              # create .tgz
cd ~/.config/opencode
npm install --ignore-scripts /path/to/opencode-fractal-memory-0.6.32.tgz
cp -r node_modules/opencode-fractal-memory/dist \
  node_modules/opencode-fractal-memory/management \
  node_modules/opencode-fractal-memory/package.json \
  node_modules/opencode-fractal-memory/LICENSE \
  node_modules/opencode-fractal-memory/commands \
  node_modules/opencode-fractal-memory/agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

Quick iteration (no package.json changes):
```bash
bun run build && cp -r dist management package.json LICENSE README.md commands agent \
  ~/.cache/opencode/packages/opencode-fractal-memory@latest/node_modules/opencode-fractal-memory/
```

Then restart OpenCode.

## Key Files

| File | Purpose |
|---|---|
| `src/config.ts` | MemConfig interface + Zod schema + defaults |
| `src/hooks/compress-output.ts` | 7 compression strategies + generic fallback |
| `src/plugin/hooks.ts` | Hook wiring (compression, file summary, rules, lifecycle) |
| `src/storage/sqlite.ts` | SqliteMemoryStore class |
| `src/management/routes.ts` | API routes (config, nodes, compression, injection quality, backup) |
| `management/public/index.html` | Management app UI |
| `management/public/app.js` | Management app JS (loadSettings, saveConfig, loadCompressStats) |
| `src/storage/migrations/definitions.ts` | DB migrations (v25 = compression_stats) |
| `install-dev.md` | Full install guide |

## Config default for commandCompression

```json
{
  "commandCompression": {
    "enabled": true,
    "maxLines": 50,
    "excludeCommands": ["curl", "wget"],
    "alwaysFullOnFailure": true
  }
}
```

## Rules

- Always cp to BOTH node_modules AND cache when installing
- Migration version in definitions.ts must increment; never modify existing migrations
- Management app config fields: id=kebab-case in HTML, load/save in app.js with same pattern
- Strategy name in compress-output.ts must be a short string (ls, test, grep, git-status, git-log, git-diff, git-quick, truncate, generic)
