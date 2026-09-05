import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { injectionMarker, recordInjection } from "../../application/injection-visibility";
import { memLog } from "../../logging";
import type { HookHandler } from "./types";
import { getCompressState, rebuildCompressState, markDeadCompressEntries } from "../../application/context-compression/state";
import { estimateMessageTokens, realMessageTokens, type SizableMessage } from "../../application/context-compression/message-size";

const HIGH_PRIORITY_TOKENS = 5000;
const MEDIUM_PRIORITY_TOKENS = 500;
const CONTEXT_LIMIT_TOKENS = 128000;

type TransformMessage = {
  info: { role?: string; id?: string; type?: string; tokens?: Record<string, unknown>; [key: string]: unknown };
  parts: Array<{ type?: string; text?: string; state?: { output?: unknown; input?: unknown; error?: unknown }; source?: { text?: { value?: unknown } }; [key: string]: unknown }>;
};

// Detect a compaction marker in the message array and derive a stable key for
// dedup (the marker PERSISTS in the view after opencode compacts, so we must
// only reset once per compaction event, not once per request).
function compactionKeyOf(messages: TransformMessage[]): string | null {
  for (const msg of messages) {
    if (msg.info?.type === "compaction" || msg.info?.type === "session.compacted") {
      return msg.info?.id ?? `type:${msg.info?.type}`;
    }
    // opencode marks compaction as a PART type ({"type":"compaction","tail_start_id":...}),
    // not info.type — info spreads row.data which has no `type` field for compaction messages.
    const part = msg.parts?.find((p) => p.type === "compaction");
    if (part) {
      return typeof part.tail_start_id === "string" ? `tail:${part.tail_start_id}` : "compaction-part";
    }
  }
  return null;
}

// Inject [message <id>] markers into user/assistant text so the model knows
// the target IDs for compress. Markers are tiny and only added
// to messages that are NOT already compressed.
function injectMessageMarkers(messages: TransformMessage[], compressed: Set<string>): void {
  for (const msg of messages) {
    const id = msg.info?.id;
    if (!id || compressed.has(id)) continue;
    const role = msg.info?.role;
    if (role !== "user" && role !== "assistant") continue;
    const textPart = msg.parts?.find((p) => p.type === "text");
    if (!textPart || typeof textPart.text !== "string") continue;
    if (textPart.text.startsWith("[message ")) continue;
    textPart.text = `[message ${id}] ${textPart.text}`;
  }
}

// Replace compressed messages with the synthetic placeholder referencing the
// saved node. Mirrors DCP's synthetic message + footer-block-ref pattern.
function replaceCompressedMessages(
  messages: TransformMessage[],
  sessionId: string,
  config: MemConfig,
): TransformMessage[] {
  const state = getCompressState(sessionId);
  if (state.blocks.size === 0) return messages;

  const out: TransformMessage[] = [];
  let replaced = 0;
  for (const msg of messages) {
    const entry = state.blocks.get(msg.info?.id ?? "");
    if (!entry) {
      out.push(msg);
      continue;
    }
    const marker = injectionMarker(config, "context-compress", "compressed " + entry.blockId);
    const synthetic = {
      info: { role: "user", id: msg.info?.id },
      parts: [{
        type: "text" as const,
        text: `${marker}[Compressed conversation section]
${entry.topic}: ${entry.summary}

[${entry.blockId}] "${entry.summary}" — full content saved as ${entry.label} — memory(mode="fetch", label="${entry.label}")
${config.injectionVisibility?.enabled === false ? "" : `[memory-plugin:context-compress] archived as ${entry.label} (msg ${entry.blockId})`}`,
      }],
    };
    out.push(synthetic as TransformMessage);
    replaced++;
  }
  if (replaced > 0) {
    memLog("debug", "context-compress", "Pruned messages replaced in transform", { sessionId, replaced });
  }
  return out;
}

// DCP-style priority nudges: list high/medium-priority messages with their
// [message <id>] markers so the model knows what to compress next. Deduped
// per turn — only nudges when at least one message crosses a threshold.
// At high context pressure (pct >= config threshold), appends a directive
// anchor telling the model to proactively archive messages irrelevant to the
// current task (not just the biggest ones).
// Proprioception dashboard + DCP-style priority nudges. Research-validated
// design (research:proactive-context-management):
//   - VISTA: models are proprioceptively blind — an ALWAYS-ON compact context
//     line every turn drives self-regulation by itself.
//   - Focus: imperative "archive now" phrasing at high pressure is validated
//     (aggressive prompting → 22.7% token reduction at identical accuracy).
// Deduped per turn — identical lines are not re-injected.
function buildNudgeLine(
  messages: TransformMessage[],
  compressed: Set<string>,
  nudgeSeen: Set<string>,
  pressureThreshold: number,
  archivedCount: number,
  store?: MemoryStore,
  sessionId?: string,
): string | null {
  const high: string[] = [];
  const medium: string[] = [];
  let totalTokens = 0;
  let largest: { id: string; tokens: number } | null = null;
  for (const msg of messages) {
    const id = msg.info?.id;
    if (!id || compressed.has(id)) continue;
    const role = msg.info?.role;
    if (role !== "user" && role !== "assistant") continue;
    const real = realMessageTokens(msg as SizableMessage);
    const tokens = real !== null ? real : estimateMessageTokens(msg as SizableMessage);
    if (tokens <= 0) continue;
    totalTokens += tokens;
    if (!largest || tokens > largest.tokens) largest = { id, tokens };
    const tag = real !== null ? "real" : "est";
    if (tokens >= HIGH_PRIORITY_TOKENS) {
      high.push(`[message ${id}] (~${tokens.toLocaleString()} tok, ${tag})`);
    } else if (tokens >= MEDIUM_PRIORITY_TOKENS) {
      medium.push(`[message ${id}] (~${tokens.toLocaleString()} tok, ${tag})`);
    }
  }
  if (totalTokens <= 0) return null;
  const pressurePct = Math.round((totalTokens / CONTEXT_LIMIT_TOKENS) * 100);
  const underPressure = totalTokens / CONTEXT_LIMIT_TOKENS >= pressureThreshold;
  const largestStr = largest ? `${largest.id} (${largest.tokens.toLocaleString()} tok)` : "—";
  const dashboard =
    `[memory-plugin:context-compress] context ${pressurePct}% | ${high.length + medium.length} msg >${MEDIUM_PRIORITY_TOKENS.toLocaleString()} tok | largest ${largestStr} | archived ${archivedCount}`;
  // Persist a pressure sample for the management app's Context tab (pressure
  // history chart). Fire-and-forget — never block the transform.
  if (store && sessionId && typeof store.recordContextPressure === "function") {
    void store.recordContextPressure({ sessionId, pressurePct, totalTokens, archivedCount }).catch(() => null);
  }
  // Always-on proprioception: even with no candidates, the one-line dashboard
  // is injected every turn (deduped when unchanged).
  const nudgeKey = `${dashboard}|${high.join(",")}|${medium.join(",")}|${underPressure ? "IMP" : ""}`;
  if (nudgeSeen.has(nudgeKey)) return null;
  nudgeSeen.add(nudgeKey);
  const lines = [dashboard];
  if (high.length > 0) {
    lines.push(`  HIGH priority (archive these with archivecontext): ${high.join(", ")}`);
  }
  if (medium.length > 0) {
    lines.push(`  MEDIUM priority: ${medium.join(", ")}`);
  }
  if (high.length > 0 || medium.length > 0) {
    lines.push("  Use the message ids above (markers on the messages) as messageId args, or archive all HIGH at once with archivecontext(allFlagged:true), or a contiguous block with archivecontext(range=\"msg_A:msg_B\") / range=\"msg_A-msg_B\" (inclusive, auto-descriptions).");
  }
  if (underPressure) {
    lines.push(
      `  PRESSURE at ~${pressurePct}% of the ${CONTEXT_LIMIT_TOKENS.toLocaleString()}-token limit. Archive now: call archivecontext(allFlagged:true) (or pass the messageIds above, or range="msg_A:msg_B" for a contiguous block). Consolidate-then-prune — archive completed investigations, obsolete context and superseded decisions, not just the largest ones; keep task-critical context. Originals are permanently saved; nothing is lost.`,
    );
  }
  return lines.join("\n");
}

export function createContextCompressTransformHandler(
  store: MemoryStore,
  config: MemConfig,
  currentSessionId: { value: string },
): HookHandler {
  const ccConfig = config.contextCompression;
  if (!ccConfig?.enabled) {
    return {};
  }

  const nudgeSeen = new Set<string>();
  // Compaction markers persist in the message array after opencode compacts —
  // this set remembers which compaction events we already reset for.
  const seenCompactionKeys = new Set<string>();

  return {
    "chat.messages.transform": async (_input: unknown, output: unknown) => {
      const out = output as { messages?: TransformMessage[] };
      if (!out.messages || out.messages.length === 0) return;

      const sessionId = currentSessionId?.value || "default";
      const state = getCompressState(sessionId);

      // COMPACTION RESET: scan for compaction messages and clear the block map
      // (message ids change after compaction — stale ids must not be pruned).
      // Also mark registry entries whose msgId is no longer in the view as
      // "compacted" so rebuilds only load prunable (live) entries and the
      // nudge stops suggesting messages that can never be pruned again.
      // GATED: the compaction marker PERSISTS in the message array after
      // opencode compacts, so without a seen-set this branch re-ran (and
      // re-wrote the registry) on every request. Only reset on a NEW marker.
      const compactionKey = compactionKeyOf(out.messages);
      if (compactionKey !== null && !seenCompactionKeys.has(compactionKey)) {
        seenCompactionKeys.add(compactionKey);
        const liveIds = new Set(out.messages.map((m) => m.info?.id).filter((x): x is string => Boolean(x)));
        state.blocks.clear();
        nudgeSeen.clear();
        await markDeadCompressEntries(store, sessionId, liveIds);
        memLog("info", "context-compress", "Compaction detected — cleared compress state", { sessionId, compactionKey });
      }

      // Rebuild from DB when empty (session start / restart after compaction).
      if (state.blocks.size === 0) {
        await rebuildCompressState(store, sessionId);
      }

      // TURN-BOUNDARY GATE: the transform fires on EVERY model request,
      // including mid-turn tool loops (assistant tool call → tool result →
      // next model call within a single response). Pruning archived messages
      // or injecting the nudge between those tool calls interrupts the agent
      // (reported: "it prunes old messages and interrupts"). Only mutate the
      // message view at a true turn boundary — the last message is a fresh
      // user message. Mid-turn requests pass through untouched.
      const lastMsg = out.messages[out.messages.length - 1];
      const atTurnBoundary = lastMsg?.info?.role === "user";
      if (!atTurnBoundary) return;

      const compressedIds = new Set(state.blocks.keys());

      // 1. Prune compressed messages (replace with synthetic placeholder).
      const pruned = replaceCompressedMessages(out.messages, sessionId, config);
      // 2. Inject [message <id>] markers on the remaining messages.
      injectMessageMarkers(pruned, compressedIds);

      // 3. Priority nudge line after the last user message (deduped per turn).
      const nudge = buildNudgeLine(pruned, compressedIds, nudgeSeen, ccConfig?.nudgePressureThreshold ?? 0.6, state.blocks.size, store, sessionId);
      if (nudge) {
        const lastUserIdx = [...pruned].reverse().findIndex((m) => m.info?.role === "user");
        if (lastUserIdx >= 0) {
          const insertAt = pruned.length - lastUserIdx;
          pruned.splice(insertAt, 0, {
            info: { role: "user" },
            parts: [{ type: "text" as const, text: nudge }],
          } as TransformMessage);
          recordInjection(config, "context-compress", "nudge: " + nudge.slice(0, 120));
        }
      }

      // In-place mutation is REQUIRED: OpenCode core keeps the original
      // `messages` array reference after the hook fires (prompt.ts passes
      // { messages: msgs } to the trigger, then continues with `msgs`).
      // Reassigning `out.messages = pruned` would be silently discarded —
      // only mutating the array object itself (length = 0 + push) reaches the
      // model request. Matches DCP's filterCompressedRanges pattern.
      // Guard: when no message was replaced, pruned IS out.messages (same
      // reference) — skip the copy to avoid self-emptying the array.
      if (pruned !== out.messages) {
        out.messages.length = 0;
        out.messages.push(...pruned);
      }
    },
  };
}