import { createHash } from "node:crypto";
import type { MemoryStore } from "../storage/sqlite";
import type { SessionApi } from "../plugin/session-api";
import type { SessionMessage } from "../plugin/messages";
import { classifyIntent } from "./ranking/intent-dist";

/**
 * Per-round intent capture, feeding the intent usefulness-vector plan
 * (P1 classifier: `ranking/intent-dist.ts`). Two sources:
 *
 * 1. `source: "agent"` — the agent-declared `intent:` line (own words,
 *    ≤30 words), taught by the hook-observe-intent seed rule. High precision
 *    when present, but agent compliance is best-effort: agents (including
 *    well-behaved ones) skip the line in some rounds.
 * 2. `source: "inferred"` — fallback when a round has no agent line: the
 *    last user message classified by the P1 heuristic classifier. The user
 *    prompt is ground truth for what the round was about, so corpus coverage
 *    no longer depends on compliance. Only recorded when the classifier
 *    finds real signal (confidence > 0) — no-signal rounds (greetings,
 *    acknowledgements) stay unrecorded to keep the corpus clean.
 *
 * V1 caught the agent line in the `text.complete` hook (deleted with the V1
 * entrypoint); the V2 re-home captures at session.execution.succeeded —
 * opencode 2.x never emits session.idle — by reading the session's messages
 * over the flat SessionApi.
 */
const INTENT_LINE_RE = /^intent:\s*(.+?)\s*$/gim;
const INTENT_MAX_WORDS = 30;
/** Cap for classification input — long user messages carry injected context. */
const INFER_CLASSIFY_MAX_CHARS = 1000;
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
 * Capture the round's intent into `intent_lines` (deduped by message id so
 * repeated round-end events are idempotent). Prefers the agent-declared
 * `intent:` line; falls back to inferring from the last user message.
 * Returns a short status string for the session log.
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
      credited = await attributeInjectedNodes(store, sessionId, cls.intent);
    } catch {
      // attribution is best-effort
    }
    const suffix = classified !== "" && credited > 0 ? ` (+${credited} nodes → ${classified})` : "";
    return `intent round ${turn} q="${intent}"${suffix}`;
  }
  // No agent line — infer the round's intent from the user prompt instead.
  return inferRoundIntent(store, sessionId, messages);
}

/**
 * Fallback capture for rounds where the agent skipped the `intent:` line:
 * classify the last user message (first INFER_CLASSIFY_MAX_CHARS — long
 * messages carry injected context past the actual prompt) and record it as
 * `source: "inferred"`. Rounds with no classifier signal are skipped, so
 * trivial exchanges don't pollute the corpus. Deduped on the user message
 * id — a refired round-end event is idempotent.
 */
async function inferRoundIntent(
  store: MemoryStore,
  sessionId: string,
  messages: SessionMessage[],
): Promise<string> {
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  if (!lastUser?.text) return "no intent line in round";
  const cls = classifyIntent(lastUser.text.slice(0, INFER_CLASSIFY_MAX_CHARS));
  if (cls.confidence === 0) return "no intent signal to infer";
  if (lastUser.id && (await store.hasIntentForMessage(lastUser.id))) {
    return "duplicate (message already recorded)";
  }
  const excerpt = lastUser.text.trim().split(/\s+/).slice(0, INTENT_MAX_WORDS).join(" ");
  const userMsgHash = createHash("sha256").update(lastUser.text).digest("hex").slice(0, 16);
  const turn = (await store.countIntentLines(sessionId)) + 1;
  await store.logIntentLine(sessionId, {
    turn,
    userMsgHash,
    rawText: excerpt,
    source: "inferred",
    messageId: lastUser.id ?? null,
  });
  let credited = 0;
  try {
    credited = await attributeInjectedNodes(store, sessionId, cls.intent);
  } catch {
    // attribution is best-effort
  }
  const suffix = credited > 0 ? ` (+${credited} nodes → ${cls.intent})` : "";
  return `intent round ${turn} (inferred) q="${excerpt}"${suffix}`;
}

/** P2 attribution: bump every node injected into the session this round. */
async function attributeInjectedNodes(
  store: MemoryStore,
  sessionId: string,
  intent: string,
): Promise<number> {
  const injected = await store.getInjectionNodeIds(sessionId);
  if (injected.length === 0) return 0;
  return store.bumpIntentVector(injected, intent);
}

/** Round-end entry: fetch the session's messages, then capture the intent. */
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
