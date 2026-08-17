import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import type { MemConfig } from "../infrastructure/config/config";
import type { ToastService } from "../infrastructure/toast-service";
import { memLog } from "../logging";
import { recordCompressBlock, nextMsgRef, getCompressState, rebuildCompressState } from "../application/context-compression/state";

const MAX_HISTORY_NODE_CHARS = 50_000;
const MAX_MESSAGE_TEXT_CHARS = 2_000;

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

The plugin replaces the pruned messages with a compact placeholder: [Compressed conversation section] TOPIC: DESCRIPTION with a footer linking to the saved node.`,
    args: {
      topic: tool.schema.string().describe("Short label for this compression batch"),
      content: tool.schema.string().describe("JSON-encoded array of messages to compress, each with messageId, topic, description"),
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

      let targets: Array<{ messageId: string; topic?: string; description: string }>;
      try {
        targets = JSON.parse(args.content ?? "[]") as Array<{ messageId: string; topic?: string; description: string }>;
      } catch {
        return "Error: content must be a JSON-encoded array of {messageId, topic, description} objects.";
      }
      if (!Array.isArray(targets)) {
        return "Error: content must be a JSON-encoded array.";
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
      const done: string[] = [];
      const skipped: string[] = [];
      const perMsg: Array<{ msgRef: string; nodeLabel: string; description: string }> = [];

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
          await toast.notifyCompression({
            messageCount: done.length,
            topic: args.topic,
            registryLabel,
          });
          memLog("debug", "context-compress", "Compression toast sent", { count: done.length, sessionId });
        } catch (err) {
          memLog("warn", "context-compress", "Compression toast failed", { error: String(err) });
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