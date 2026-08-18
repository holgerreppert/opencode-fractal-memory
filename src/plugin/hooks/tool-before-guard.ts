import type { HookHandler } from "./types";
import { memLog } from "../../logging";

const MAX_HINTS_PER_SESSION = 3;
const MAX_REWRITES_TRACKED = 50;

// ripgrep's `-r` is `--replace`, NOT "recursive" (rg recurses by default).
// `rg -rn "pat"` is parsed as `-r n` → every match is replaced with "n",
// silently mangling the output into `n`-filled garbage. Same for `-rl`, `-rw`,
// etc. Detect the footgun so the model can be warned instead of confused.
export function detectRgReplaceMisuse(command: string): string | null {
  const trimmed = command.trim();
  // Command may be prefixed (cd ... && rg, export ..., etc.) — locate the
  // rg invocation anywhere in the command line.
  const rgMatch = /\b(?:rg|ripgrep)\b/.exec(trimmed);
  if (!rgMatch) return null;
  const tail = trimmed.slice(rgMatch.index);
  // `-r` must be a standalone short flag (preceded by whitespace or start, not
  // another `-` which would make it `--replace`).
  const m = /(?:^|\s)-r([a-z][a-z]*)(?=\s|$)/.exec(tail);
  if (!m) return null;
  const letters = m[1]!;
  // -r followed by a quoted value (`-r "x"`) is a legit --replace; the footgun
  // is only the glued short-flag form like -rn / -rl / -rw.
  if (letters.length === 0) return null;
  return letters;
}

// Correct the footgun in place: `-r<letters>` → `-<letters>` (e.g. `-rn` → `-n`,
// `-rl` → `-l`), preserving the user's intent while dropping the erroneous
// `-r` (rg recurses by default). Returns null when no rewrite applies.
export function rewriteRgReplaceMisuse(command: string): string | null {
  const rgMatch = /\b(?:rg|ripgrep)\b/.exec(command);
  if (!rgMatch) return null;
  const tail = command.slice(rgMatch.index);
  const m = /(?:^|\s)-r([a-z][a-z]*)(?=\s|$)/.exec(tail);
  if (!m) return null;
  const letters = m[1]!;
  if (letters.length === 0) return null;
  const leadingLen = /^\s/.test(m[0]) ? 1 : 0;
  const tokenStart = rgMatch.index + m.index + leadingLen;
  const tokenLen = 2 + letters.length;
  return command.slice(0, tokenStart) + "-" + letters + command.slice(tokenStart + tokenLen);
}

export function rgFootgunHint(replaceMisuse: string): string {
  return `[rg-footgun] \`rg -r${replaceMisuse}\` means \`-r ${replaceMisuse}\` (\`--replace\`) in ripgrep, NOT recursive — every match was rewritten to "${replaceMisuse}" in the output above. Use \`rg -n\` instead (rg recurses by default).`;
}

function shouldShowHint(sessionId: string, hintKey: string, hintCounts: Map<string, Map<string, number>>): boolean {
  const sessionHints = hintCounts.get(sessionId);
  if (!sessionHints) {
    hintCounts.set(sessionId, new Map([[hintKey, 1]]));
    return true;
  }
  const count = sessionHints.get(hintKey) ?? 0;
  if (count >= MAX_HINTS_PER_SESSION) return false;
  sessionHints.set(hintKey, count + 1);
  return true;
}

export function createToolBeforeGuardHandler(): HookHandler {
  // Per-handler-instance state — module-level maps leaked across instances and
  // test reruns in the same process (the hint cap for a session was consumed by
  // the first run, silently silencing subsequent runs).
  const hintCounts = new Map<string, Map<string, number>>();
  const rewrittenCalls = new Map<string, string>();
  return {
    // Rewrite the footgun in `tool.before` so the command never executes
    // mangled: `rg -rn "pat"` → `rg -n "pat"`. `tool.before` output exposes a
    // writable `{ args }` (unlike `output.output`, which is dropped there).
    "tool.before": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: Record<string, unknown>; sessionID?: string; callID?: string };
      const tool = input.tool;
      if (tool !== "bash") return;
      // `args` may be passed via input (observed live) or output (per the
      // @opencode-ai/plugin d.ts `{ args }` shape) — read from either.
      const out = output as { args?: Record<string, unknown> };
      const command = (input.args?.command ?? out.args?.command ?? "") as string;
      const rewritten = rewriteRgReplaceMisuse(command);
      if (!rewritten) return;
      // Write the corrected command to BOTH so it survives whichever object
      // OpenCode actually consumes.
      const replaceMisuse = detectRgReplaceMisuse(command);
      if (input.args) input.args.command = rewritten;
      if (out.args) out.args.command = rewritten;
      const callKey = `${input.sessionID ?? "default"}:${input.callID ?? "?"}`;
      if (rewrittenCalls.size >= MAX_REWRITES_TRACKED) rewrittenCalls.clear();
      rewrittenCalls.set(callKey, replaceMisuse ?? "");
      memLog("info", "rg-footgun", "rewrote before execute", {
        from: command.slice(0, 80),
        to: rewritten.slice(0, 80),
      });
    },

    // NOTE: `tool.execute.before` output only exposes `{ args }` (see
    // @opencode-ai/plugin v1.4.x types) — `output.output` mutations are silently
    // dropped there. Hints that must reach the model are delivered via
    // `tool.after`, which exposes a writable `{ output }` (same pattern as
    // graph-search-hint / graph-context). After a successful rewrite the
    // command no longer triggers the detector, so the note below only appears
    // when the rewrite happened (transparency) or when `tool.before` never
    // fired (fallback hint on the un-rewritten command).
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: Record<string, unknown>; sessionID?: string; callID?: string };
      const tool = input.tool;
      memLog("info", "rg-footgun", "tool.after entered", { tool: tool ?? "?", sessionID: input.sessionID ?? "?" });
      if (tool !== "bash") return;
      const command = (input.args?.command ?? "") as string;
      memLog("info", "rg-footgun", "bash command seen", { cmd: command.slice(0, 80) });
      const out = output as { output?: string };
      const callKey = `${input.sessionID ?? "default"}:${input.callID ?? "?"}`;
      const rewrittenLetters = rewrittenCalls.get(callKey);
      if (rewrittenLetters !== undefined) {
        rewrittenCalls.delete(callKey);
        const note = `[rg-footgun] auto-corrected: command was rewritten from \`rg -r${rewrittenLetters}\` to \`rg -${rewrittenLetters}\` before execution (ripgrep's \`-r\` is \`--replace\`, not recursive). Output above is from the corrected command.`;
        if (typeof out.output === "string") {
          out.output = out.output + "\n\n" + note;
        } else {
          out.output = note;
        }
        return;
      }
      const replaceMisuse = detectRgReplaceMisuse(command);
      memLog("info", "rg-footgun", "detect result", { misuse: replaceMisuse ?? null });
      if (!replaceMisuse) return;

      const sessionId = input.sessionID ?? "default";
      const hintKey = `rg-footgun:${replaceMisuse}`;
      if (!shouldShowHint(sessionId, hintKey, hintCounts)) return;

      const hint = rgFootgunHint(replaceMisuse);
      if (typeof out.output === "string") {
        out.output = out.output + "\n\n" + hint;
      } else {
        out.output = hint;
      }
    },
  };
}
