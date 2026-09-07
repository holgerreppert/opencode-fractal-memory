import { createHash } from "node:crypto";
import { memLog } from "../../logging";
import type { MemoryStore } from "../../storage/sqlite";
import type { HookHandler } from "./types";

// DCP-style hallucination stripping: once the plugin injects [message <id>]
// markers and [Compressed conversation section] placeholders into the context,
// the model WILL imitate them in its text output (prompt-injection-style
// noise). Assistant output should never contain these markers — they live only
// in injected user messages — so strip all occurrences from streamed text.

const MESSAGE_MARKER_RE = /\[message\s+[^\]]+\]\s*/g;
const COMPRESSED_SECTION_RE = /\[Compressed conversation section\]\s*/g;
const MEMORY_PLUGIN_TAG_RE = /\[memory-plugin:context-compress[^\]]*\]\s*/g;

// Agent-declared per-round intent: own words, one line, max ~30 words.
// Taught by rule:mandatory:memory. Caught here, logged for statistics,
// consumed by nothing yet — first find out what intents the agent faces.
const INTENT_LINE_RE = /^intent:\s*(.+?)\s*$/gim;
const INTENT_MAX_WORDS = 30;

export function extractIntentLine(text: string): string | null {
  if (!text) return null;
  INTENT_LINE_RE.lastIndex = 0;
  const m = INTENT_LINE_RE.exec(text);
  if (!m || !m[1] || m[1].trim().length === 0) return null;
  const words = m[1].trim().split(/\s+/);
  return words.slice(0, INTENT_MAX_WORDS).join(" ");
}

export function stripHallucinatedCompressMarkers(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(MESSAGE_MARKER_RE, "");
  out = out.replace(COMPRESSED_SECTION_RE, "");
  out = out.replace(MEMORY_PLUGIN_TAG_RE, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

export function createTextCompleteHandler(
  store?: MemoryStore,
  currentSessionId?: { value: string },
  latestUserMessage?: { value: string },
): HookHandler {
  const turnBySession = new Map<string, number>();
  return {
    "text.complete": async (_input: unknown, output: unknown) => {
      const out = output as { text?: string };
      if (typeof out.text !== "string" || out.text.length === 0) return;
      const stripped = stripHallucinatedCompressMarkers(out.text);
      if (stripped !== out.text) {
        memLog("debug", "context-compress", "Stripped hallucinated compress markers from text", {
          removed: out.text.length - stripped.length,
        });
        out.text = stripped;
      }
      // Catch agent-declared intent line. Malformed/missing → silent skip
      // (compliance itself is the stat); never break the round.
      try {
        const intent = extractIntentLine(out.text);
        if (intent === null) return;
        const sessionId = currentSessionId?.value || "default";
        const turn = (turnBySession.get(sessionId) ?? 0) + 1;
        turnBySession.set(sessionId, turn);
        const userMsg = latestUserMessage?.value ?? "";
        const userMsgHash = userMsg
          ? createHash("sha256").update(userMsg).digest("hex").slice(0, 16)
          : null;
        memLog("info", "intent", `intent round ${turn} q="${intent}"`, { sessionId });
        if (store) {
          await store.logIntentLine(sessionId, { turn, userMsgHash, rawText: intent, source: "agent" });
        }
      } catch (err) {
        memLog("debug", "intent", "Intent catch failed silently", { error: String(err) });
      }
    },
  };
}