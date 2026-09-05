import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import type { MemConfig } from "../infrastructure/config/config";
import type { ToastService } from "../infrastructure/toast-service";
import { memLog } from "../logging";
import { recordCompressBlock, nextMsgRef, getCompressState, rebuildCompressState } from "../application/context-compression/state";
import { estimateMessageTokens, realMessageTokens, partPayloadText, type SizableMessage } from "../application/context-compression/message-size";

const MAX_HISTORY_NODE_CHARS = 50_000;
const MAX_MESSAGE_TEXT_CHARS = 2_000;

// allFlagged floor: only messages at/above this token size are bulk-archived.
// Matches the nudge's HIGH priority tier — avoids net-loss archiving of small
// messages (tool-call overhead > tokens saved).
const ALL_FLAGGED_MIN_TOKENS = 5_000;
const ALL_FLAGGED_MAX = 10;
const AUTO_DESC_CHARS = 200;

type FetchedMessage = {
  info?: { id?: string; role?: string; agent?: string | null; time?: { created?: number } };
  parts?: Array<{ type?: string; text?: string; name?: string; input?: unknown; isError?: boolean }>;
};

// Build a structured archive entry from a message's parts (same format as the
// compaction hook used for storedcontext captures — caps per part).
function formatMessageEntry(msg: FetchedMessage): string {
  const role = msg.info?.role ?? "unknown";
  const agent = msg.info?.agent ?? "";
  const time = msg.info?.time?.created ? new Date(msg.info.time.created).toISOString() : "";
  let textContent = "";
  if (msg.parts && Array.isArray(msg.parts)) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        textContent += part.text.slice(0, MAX_MESSAGE_TEXT_CHARS) + "\n";
      } else if (part.type === "reasoning" && part.text) {
        textContent += `[reasoning] ${part.text.slice(0, MAX_MESSAGE_TEXT_CHARS)}\n`;
      } else if (part.type === "tool_use" && part.name) {
        textContent += `[tool: ${part.name}${part.input ? ` ${JSON.stringify(part.input).slice(0, 200)}` : ""}]\n`;
      } else if (part.type === "tool_result") {
        const resultText = part.text ? part.text.slice(0, 500) : "";
        textContent += `[result: ${part.isError ? "error" : "ok"}${resultText ? " " + resultText : ""}]\n`;
      }
    }
  }
  if (!textContent.trim()) return "";
  return `[${time} ${role === "user" ? "User" : "Assistant"}${agent ? ` (${agent})` : ""}]\n${textContent.trim()}`;
}

function formatArchivedSlice(entry: { msgRef: string; topic: string; description: string }, messageEntry: string): string {
  const lines = [
    `--- slice ${entry.msgRef} ---`,
    `topic: ${entry.topic}`,
    `description: ${entry.description}`,
    "",
    messageEntry,
  ];
  return lines.join("\n");
}

export function createContextCompressTool(store: MemoryStore, client: unknown, config: MemConfig, toast?: ToastService) {
  return tool({
    description: `Compress (prune) conversation messages to free context, while PERMANENTLY SAVING the full original content as a memory node. Unlike plain pruning, nothing is lost — every pruned message is archived as a contexthistory node you can retrieve later with memory(mode="fetch", label="LABEL"). Use this when the conversation is getting long and earlier messages can be condensed to a short summary.

Args:
  topic: short label for this compression batch, e.g. debugging-graph-hook
  content: JSON-encoded array of messages to compress, each with these fields:
    messageId: the raw message id (the marker shown on the message)
    topic: per-message sub-topic
    description: SMALL (1-3 lines) description of the message content — shown in the compressed placeholder and stored as the archive summary
  range: inclusive msgId range, e.g. "msg_abc:msg_def" or "msg_abc-msg_def" — archives every message between the two ids in view order (inclusive), inclusive bounds. Combine with fromTime/toTime/pattern to narrow.
  fromTime/toTime: ISO timestamp bounds (inclusive)
  pattern: substring filter (applied after range/time)

The plugin replaces the pruned messages with a compact placeholder: [Compressed conversation section] TOPIC: DESCRIPTION with a footer linking to the saved node.`,
    args: {
      topic: tool.schema.string().describe("Short label for this compression batch"),
      content: tool.schema.string().optional().describe("JSON-encoded array of messages to compress, each with messageId, topic, description"),
      allFlagged: tool.schema.boolean().optional().describe("Archive every nudge-flagged HIGH-priority message (>= 5000 tokens, max 10) in one call. Auto-generates topic/description from content. Overrides content."),
      range: tool.schema.string().optional().describe("Inclusive msgId range, e.g. \"msg_abc:msg_def\" or \"msg_abc-msg_def\" — archives every message between the two ids in view order (inclusive). Auto-generates description from content. Use to archive a contiguous block without listing each id."),
      fromTime: tool.schema.string().optional().describe("ISO timestamp lower bound (inclusive) — only messages at/after this time are considered."),
      toTime: tool.schema.string().optional().describe("ISO timestamp upper bound (inclusive) — only messages at/before this time are considered."),
      pattern: tool.schema.string().optional().describe("Substring filter — only messages whose text contains this string are archived (combines with range/time)."),
    },
    async execute(args, toolCtx) {
      const ccConfig = config.contextCompression;
      if (!ccConfig?.enabled) {
        return "contextCompression is disabled in config.";
      }
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return "No session ID available — run within a session.";
      }

      await rebuildCompressState(store, sessionId);

      const typedClient = client as { session?: { messages: (opts: unknown) => Promise<{ data?: Array<FetchedMessage>; [key: string]: unknown }> } };
      const messagesResponse = typedClient?.session?.messages
        ? await typedClient.session.messages({ path: { id: sessionId } })
        : null;
      const messages: FetchedMessage[] =
        ((messagesResponse?.data ?? messagesResponse) as unknown as FetchedMessage[]) ?? [];

      const byId = new Map<string, FetchedMessage>();
      for (const m of messages) {
        if (m.info?.id) byId.set(m.info.id, m);
      }

      const state = getCompressState(sessionId);
      const skipIds = new Set(state.blocks.keys());

      // allFlagged: deterministic bulk-archive of the largest messages, sorted
      // biggest-first, capped. No LLM judgment — Deep Agents pattern (research:
      // proactive-context-management): auto-offload is deterministic, not judged.
      let targets: Array<{ messageId: string; topic?: string; description: string }>;
      if (args.allFlagged) {
        const flagged: Array<{ messageId: string; description: string; tokens: number }> = [];
        for (const m of messages) {
          const id = m.info?.id;
          if (!id || skipIds.has(id)) continue;
          const role = m.info?.role;
          if (role !== "user" && role !== "assistant") continue;
          const real = realMessageTokens(m as unknown as SizableMessage);
          const tokens = real !== null ? real : estimateMessageTokens(m as unknown as SizableMessage);
          if (tokens < ALL_FLAGGED_MIN_TOKENS) continue;
          const text = m.parts?.map((p) => partPayloadText(p as Parameters<typeof partPayloadText>[0])).filter(Boolean).join(" ").trim() ?? "";
          if (!text) continue;
          flagged.push({
            messageId: id,
            tokens,
            description: `auto-flagged (${tokens.toLocaleString()} tok): ${text.slice(0, AUTO_DESC_CHARS)}`,
          });
        }
        flagged.sort((a, b) => b.tokens - a.tokens);
        targets = flagged.slice(0, ALL_FLAGGED_MAX).map((f) => ({
          messageId: f.messageId,
          topic: args.topic ?? "auto-flagged-bulk-archive",
          description: f.description,
        }));
        if (targets.length === 0) {
          return `allFlagged: no messages above the ${ALL_FLAGGED_MIN_TOKENS.toLocaleString()}-token floor (already-compressed excluded). Nothing to archive.`;
        }
      } else if (args.range || args.fromTime || args.toTime || args.pattern) {
        // Range / time / pattern mode: deterministic expansion, auto-descriptions
        let candidateIds: string[] = [];

        if (args.range) {
          const raw = args.range.trim();
          // Support "A:B", "A-B", "A..B" (colon/dash/dotdot)
          let sep = raw.includes(":") ? ":" : raw.includes("..") ? ".." : "-";
          const parts = raw.split(sep);
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            return `Error: range must be "START:END" (inclusive), e.g. "msg_abc:msg_def". Got "${args.range}".`;
          }
          const a = parts[0].trim();
          const b = parts[1].trim();
          // Resolve indices in view order (messages array order = chronological view)
          const idxOf = (needle: string): number => {
            const exact = messages.findIndex((m) => m.info?.id === needle);
            if (exact !== -1) return exact;
            // prefix match (nudge shows full id but allow short prefix)
            const pref = messages.findIndex((m) => (m.info?.id ?? "").startsWith(needle) || needle.startsWith(m.info?.id ?? "___"));
            return pref;
          };
          const ia = idxOf(a);
          const ib = idxOf(b);
          if (ia === -1) return `Error: range start "${a}" not found in current view.`;
          if (ib === -1) return `Error: range end "${b}" not found in current view.`;
          if (ib < ia) return `Error: range is reversed — "${a}" appears after "${b}" in view order. Use "START:END" in view order.`;
          candidateIds = messages.slice(ia, ib + 1).map((m) => m.info?.id).filter((x): x is string => Boolean(x));
        } else {
          candidateIds = messages.map((m) => m.info?.id).filter((x): x is string => Boolean(x));
        }

        // Time bounds (inclusive)
        const fromMs = args.fromTime ? Date.parse(args.fromTime) : NaN;
        const toMs = args.toTime ? Date.parse(args.toTime) : NaN;
        if (args.fromTime && Number.isNaN(fromMs)) return `Error: fromTime is not a valid ISO timestamp: "${args.fromTime}".`;
        if (args.toTime && Number.isNaN(toMs)) return `Error: toTime is not a valid ISO timestamp: "${args.toTime}".`;

        const pattern = args.pattern ?? null;

        targets = [];
        for (const id of candidateIds) {
          if (skipIds.has(id)) continue;
          const msg = byId.get(id);
          if (!msg) continue;
          const role = msg.info?.role;
          if (role !== "user" && role !== "assistant") continue;
          // time filter
          if (!Number.isNaN(fromMs) || !Number.isNaN(toMs)) {
            const t = msg.info?.time?.created;
            const ms = typeof t === "number" ? t : typeof t === "string" ? Date.parse(t) : NaN;
            if (!Number.isNaN(fromMs) && (Number.isNaN(ms) || ms < fromMs)) continue;
            if (!Number.isNaN(toMs) && (Number.isNaN(ms) || ms > toMs)) continue;
          }
          // pattern filter
          const textForFilter = msg.parts?.map((p) => partPayloadText(p as Parameters<typeof partPayloadText>[0])).filter(Boolean).join(" ").trim() ?? "";
          if (pattern && !textForFilter.includes(pattern)) continue;
          if (!textForFilter) continue; // skip no-text like already handled
          targets.push({
            messageId: id,
            topic: args.topic ?? "range-archive",
            description: `range (${textForFilter.slice(0, AUTO_DESC_CHARS).replace(/\s+/g, " ").trim()}${textForFilter.length > AUTO_DESC_CHARS ? "…" : ""})`,
          });
        }

        if (targets.length === 0) {
          return `range: no messages matched (range=${args.range ?? "-"} pattern=${pattern ?? "-"} fromTime=${args.fromTime ?? "-"} toTime=${args.toTime ?? "-"}). Nothing to archive.`;
        }
      } else {
        if (!args.content) return "Error: provide content (JSON array), or range/pattern/fromTime/toTime, or allFlagged:true.";
        try {
          targets = JSON.parse(args.content) as Array<{ messageId: string; topic?: string; description: string }>;
        } catch {
          return "Error: content must be a JSON-encoded array of {messageId, topic, description} objects.";
        }
        if (!Array.isArray(targets)) {
          return "Error: content must be a JSON-encoded array.";
        }
      }
      const done: string[] = [];
      const skipped: string[] = [];
      const perMsg: Array<{ msgRef: string; nodeLabel: string; description: string }> = [];
      let removedChars = 0;
      let summaryChars = 0;

      for (const target of targets) {
        const msg = byId.get(target.messageId);
        if (!msg) {
          skipped.push(`${target.messageId} (unknown)`);
          continue;
        }
        if (state.blocks.has(target.messageId)) {
          skipped.push(`${target.messageId} (already compressed)`);
          continue;
        }

        const messageEntry = formatMessageEntry(msg);
        if (!messageEntry) {
          skipped.push(`${target.messageId} (no text content)`);
          continue;
        }
        removedChars += messageEntry.length;
        summaryChars += (target.description ?? "").length;

        // Merged per-session history chain: append to the current history node,
        // rotate to a new node when it would exceed the cap.
        const msgRef = nextMsgRef(sessionId);
        const historyLabel = await appendToHistory(store, sessionId, {
          msgRef,
          topic: target.topic ?? args.topic,
          description: target.description,
          messageEntry,
        });
        await appendToRegistry(store, sessionId, {
          ref: msgRef,
          msgId: target.messageId,
          status: "archived",
          summary: target.description,
          label: historyLabel,
          topic: target.topic ?? args.topic,
        });

        recordCompressBlock(sessionId, target.messageId, {
          blockId: msgRef,
          nodeId: historyLabel,
          label: historyLabel,
          summary: target.description,
          topic: target.topic ?? args.topic,
        });
        done.push(target.messageId);
        perMsg.push({ msgRef, nodeLabel: historyLabel, description: target.description });
      }

      if (done.length === 0) {
        return `No messages compressed. Skipped: ${skipped.join(", ") || "none"}.`;
      }

      if (toast?.isEnabled) {
        const registryLabel = `contexthistory:index:${sessionId}`;
        try {
          const agent = (toolCtx as { agent?: string }).agent;
          const notif: {
            sessionId: string;
            messageCount: number;
            topic: string;
            registryLabel: string;
            agent?: string;
            entries: Array<{ msgRef: string; nodeLabel: string; description: string }>;
            removedChars: number;
            summaryChars: number;
            totalMessages: number;
          } = {
            sessionId,
            messageCount: done.length,
            topic: args.topic,
            registryLabel,
            entries: perMsg,
            removedChars,
            summaryChars,
            totalMessages: messages.length,
          };
          if (agent) notif.agent = agent;
          await toast.notifyCompression(notif);
          memLog("debug", "context-compress", "Compression notification sent", { count: done.length, sessionId, mode: toast.mode });
        } catch (err) {
          memLog("warn", "context-compress", "Compression notification failed", { error: String(err) });
        }
      }

      const lines = [
        `## Compressed ${done.length} message(s) to context history`,
        `Topic: ${args.topic}`,
        "",
        "Pruned messages will be replaced by compact placeholders with [message <id>] refs.",
        "Full originals are archived and retrievable via memory(mode=\"fetch\", label=...) or the registry:",
        `- Registry: contexthistory:index:${sessionId}`,
      ];
      for (const p of perMsg) {
        lines.push(`- [${p.msgRef}] "${p.description}" → ${p.nodeLabel}`);
      }
      if (skipped.length > 0) {
        lines.push("");
        lines.push(`Skipped: ${skipped.join(", ")}`);
      }
      lines.push("");
      lines.push(`Use memory(mode="fetch", label="contexthistory:index:${sessionId}") to list all archived messages for this session.`);
      return lines.join("\n");
    },
  });
}

// Append a slice to the session's merged history chain. Returns the history
// node label the slice was written into. Rotates to a new node past the cap.
async function appendToHistory(
  store: MemoryStore,
  sessionId: string,
  slice: { msgRef: string; topic: string; description: string; messageEntry: string },
): Promise<string> {
  const sliceText = formatArchivedSlice(slice, slice.messageEntry);
  const currentIndex = await getCurrentHistoryIndex(store, sessionId);

  let node = await getHistoryNode(store, sessionId, currentIndex);
  if (!node) {
    node = await createHistoryNode(store, sessionId, currentIndex);
  }
  if ((node.content?.length ?? 0) + sliceText.length > MAX_HISTORY_NODE_CHARS) {
    const nextIndex = currentIndex + 1;
    node = await createHistoryNode(store, sessionId, nextIndex);
    await updateRegistryIndex(store, sessionId, nextIndex);
  }
  const newContent = `${node.content ?? ""}\n\n${sliceText}`.trim();
  await store.updateNode(node.id, { content: newContent });
  return node.label ?? `contexthistory:${sessionId}:${node.id.slice(0, 8)}`;
}

async function getCurrentHistoryIndex(store: MemoryStore, sessionId: string): Promise<number> {
  try {
    const registry = await store.getNodeByLabel("project", `contexthistory:index:${sessionId}`);
    const meta = registry?.metadata as Record<string, unknown> | null;
    const idx = meta?.currentHistoryIndex;
    return typeof idx === "number" ? idx : 0;
  } catch {
    return 0;
  }
}

async function updateRegistryIndex(store: MemoryStore, sessionId: string, index: number): Promise<void> {
  try {
    const registry = await store.getNodeByLabel("project", `contexthistory:index:${sessionId}`);
    if (!registry) return;
    await store.updateNode(registry.id, {
      metadata: { ...((registry.metadata as Record<string, unknown>) ?? {}), currentHistoryIndex: index },
    });
  } catch { /* best-effort */ }
}

async function getHistoryNode(store: MemoryStore, sessionId: string, index: number): Promise<{ id: string; content?: string; label?: string | null } | null> {
  try {
    return await store.getNodeByLabel("project", `contexthistory:${sessionId}:${index}`);
  } catch {
    return null;
  }
}

async function createHistoryNode(store: MemoryStore, sessionId: string, index: number): Promise<{ id: string; content?: string; label?: string | null }> {
  const label = `contexthistory:${sessionId}:${index}`;
  const node = await store.createNode({
    scope: "project",
    label,
    content: "",
    type: "contexthistory",
    level: 0,
    parentIds: null,
    embedding: null,
    embeddingSegments: null,
    importance: 0.5,
    usefulnessScore: 0.1,
    source: "auto_extract",
    sticky: true,
    ttlDays: 30,
    tags: ["contexthistory", `sess:${sessionId}`],
    metadata: { sessionId, historyIndex: index, kind: "context-history" },
    summary: `Archived context history for session ${sessionId} (part ${index})`,
  });
  memLog("debug", "context-compress", "Created history node", { label, sessionId });
  return node;
}

// Registry node: contexthistory:index:<sessionId> — the session's msgRef
// address book. Entries: msgRef -> { status, summary, label, topic }.
async function appendToRegistry(
  store: MemoryStore,
  sessionId: string,
  entry: { ref: string; msgId: string; status: string; summary: string; label: string; topic: string },
): Promise<void> {
  const registryLabel = `contexthistory:index:${sessionId}`;
  let registry: { id: string; content?: string | null; metadata?: Record<string, unknown> | null } | null = null;
  try {
    registry = await store.getNodeByLabel("project", registryLabel);
  } catch { /* create below */ }

  if (!registry) {
    await store.createNode({
      scope: "project",
      label: registryLabel,
      content: JSON.stringify({ entries: [entry] }),
      type: "contexthistory",
      level: 0,
      parentIds: null,
      embedding: null,
      embeddingSegments: null,
      importance: 0.5,
      usefulnessScore: 0.1,
      source: "auto_extract",
      sticky: true,
      tags: ["contexthistory", "index", `sess:${sessionId}`],
      metadata: { sessionId, currentHistoryIndex: 0, kind: "context-history-index" },
      summary: `Compressed-context registry for session ${sessionId} — msgRef → archived message index`,
    });
    memLog("debug", "context-compress", "Created registry node", { sessionId });
    return;
  }

  let entries: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(registry.content ?? "{}") as { entries?: Array<Record<string, unknown>> };
    entries = parsed.entries ?? [];
  } catch { entries = []; }
  entries.push({ ...entry });
  await store.updateNode(registry.id, { content: JSON.stringify({ entries }) });
}

export { MAX_HISTORY_NODE_CHARS };