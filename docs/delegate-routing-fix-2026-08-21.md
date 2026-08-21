# Delegate Routing Fix 2026-08-21

Root cause: `opencode-model-router.overrides.jsonc` fallback mis-keyed as `fallback.presets.zen.zen` (protocol expects `fallback.global.<preset>`) and missing presets `openrouter`/`nvidia` → fallback chain `zen->openrouter->local->nvidia->mittwald` filtered to `zen->mittwald` or broken, so Tasks hitting zen quota (429) cancelled instead of retrying.

Fix applied to `~/.config/opencode/opencode-model-router.overrides.jsonc`:
- Added `openrouter` preset (models `openrouter/qwen/qwen3-coder:free`, `openrouter/nvidia/nemotron-3-nano-30b-a3b:free`, `openrouter/google/gemma-4-31b:free`) — reuses `provider.openrouter` already in `opencode.json`
- Added `nvidia` preset (models `nvidia/nvidia/nemotron-3-ultra-550b-a55b`) — reuses `provider.nvidia` already in `opencode.json`
- Fixed fallback key to `fallback.global.zen = ["openrouter","local","nvidia","mittwald"]` (matches `src/router/protocol.ts:20-39` `fallback.global.<preset>`)
- `activePreset` stays `zen` (free-first), `local`/`mittwald` preserved; `provider.mittwald` already has `toolStreaming:false` for Qwen3.6 and `src/index.ts` already patched to forward `modelOptions` (verified at 890-911)

Verification: `python json.loads` after comment strip → presets 5, fallback global zen chain correct; `opencode models` shows all provider models present. No `state.json` override exists. Requires restart: `opencode-model-router@1.3.0` re-reads overrides on startup, then `Err→retry-alt-tier→fail→direct` renders as `Chain: zen->openrouter->local->nvidia->mittwald`.

Next: restart opencode, dispatch `Task(@fast, CAP:5)` test; should no longer cancel on 429 but fallback through chain.
