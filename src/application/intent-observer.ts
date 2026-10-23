import { createHash } from "node:crypto";
import type { MemoryStore } from "../storage/sqlite";
import type { SessionApi } from "../plugin/session-api";
import type { SessionMessage } from "../plugin/messages";
import { classifyIntent } from "./ranking/intent-dist";

/**
 * Agent-declared per-round intent: own words, one line, max ~30 words —
 * taught by the hook-observe-intent seed rule. V1 caught the line in the
 * `text.complete` hook (that hook was deleted with the V1 entrypoint); the
 * V2 re-home catches it at `session.idle` by reading the round's assistant
 * messages over the flat SessionApi. Rows feed the intent
 * usefulness-vector plan (P1 classifier: `ranking/intent-dist.ts`).
 */
const INTENT_LINE_RE = /^intent:\s*(.+?)\s*$/gim;
const INTENT_MAX_WORDS = 30;
/** Newest-first scan window over the round's assistant messages. */
const SCAN_LAST_ASSISTANT = 5;

/** Extract the agent-declared intent line, capped at 30 words. */
export function extractIntentLine(text: string): string | null {
  if (!text) return null;
  INTENT_LINE_RE.lastIndex = 0;
  const m = INTENT_LINE_RE.exec(text);
  if (!m || !m[1] || m[1].trim().length === 0) return null;
  const words = m[1].trim().split(/\s+/);
  return words.slice(0, INTENT_MAX_WORDS).join(" ");
}

/**
 * Capture the round's newest intent line into `intent_lines` (deduped by
 * message id so repeated idle events are idempotent). Returns a short
 * status string for the session log.
 */
export async function captureRoundIntent(
  store: MemoryStore,
  sessionId: string,
  messages: SessionMessage[],
): Promise<string> {
  const assistants = messages.filter(m => m.role === "assistant");
  const scanned = assistants.slice(-SCAN_LAST_ASSISTANT).reverse();
  for (const msg of scanned) {
    const intent = extractIntentLine(msg.text ?? "");
    if (intent === null) continue;
    if (msg.id && (await store.hasIntentForMessage(msg.id))) {
      return "duplicate (message already recorded)";
    }
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const userMsgHash = lastUser?.text
      ? createHash("sha256").update(lastUser.text).digest("hex").slice(0, 16)
      : null;
    // Persisted count (not an in-memory map) keeps turn numbers stable
    // across restarts — the V1 observer's counter reset with the process.
    const turn = (await store.countIntentLines(sessionId)) + 1;
    await store.logIntentLine(sessionId, {
      turn,
      userMsgHash,
      rawText: intent,
      source: "agent",
      messageId: msg.id ? msg.id : null,
    });
    // P2 attribution: credit the nodes injected this round with the
    // classified intent (best-effort — vector writes never fail the capture).
    let credited = 0;
    let classified = "";
    try {
      const cls = classifyIntent(intent);
      classified = cls.intent;
      const injected = await store.getInjectionNodeIds(sessionId);
      if (injected.length > 0) credited = await store.bumpIntentVector(injected, cls.intent);
    } catch {
      // attribution is best-effort
    }
    const suffix = classified !== "" && credited > 0 ? ` (+${credited} nodes → ${classified})` : "";
    return `intent round ${turn} q="${intent}"${suffix}`;
  }
  return "no intent line in round";
}

/** Idle-time entry: fetch the session's messages, then capture the intent. */
export async function captureSessionIntent(
  store: MemoryStore,
  sessionId: string,
  client: SessionApi,
): Promise<string> {
  if (!sessionId || sessionId === "unknown") return "no session id";
  try {
    const messages = await client.messages({ sessionID: sessionId });
    return await captureRoundIntent(store, sessionId, messages);
  } catch (err) {
    return `intent capture failed: ${String(err)}`;
  }
}
