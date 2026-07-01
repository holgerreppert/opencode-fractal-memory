import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog, appendSessionLog } from "../../logging";
import { generateEmbedding } from "../../infrastructure/llm/embeddings";
import { getWorkingCache, addToWorkingCache } from "../../application/cache";
import { cleanupMiddleTermCaptures } from "../state";
import type { HookHandler } from "./types";

export function createCompactionHandler(store: MemoryStore, config: MemConfig, client: unknown): HookHandler {
  return {
    "compacting": async (_input: unknown, output: unknown) => {
      const input = _input as { sessionID: string };
      const out = output as { context: string[]; prompt?: string };
      const sessionId = input.sessionID;

      if (!config?.enableMiddleTermCapture) {
        out.context = [];
        return;
      }

      try {
        let cache = getWorkingCache(sessionId);
        const summaries: string[] = [];

        if (cache.length === 0) {
          try {
            const allNodes = await store.listNodes("project");
            const recent = allNodes
              .filter(n => n.createdAt)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, 8);
            if (recent.length > 0) {
              for (const n of recent) {
                addToWorkingCache(sessionId, {
                  id: n.id,
                  label: n.label ?? n.id.slice(0, 8),
                  content: n.content ?? "",
                  importance: n.importance ?? 0.5,
                });
              }
              cache = getWorkingCache(sessionId);
              summaries.push(`Fell back to ${recent.length} most recently created nodes.`);
            }
          } catch { /* best-effort */ }
        }

        if (cache.length > 0) {
          summaries.push(`Working cache has ${cache.length} active entries.`);
          const topCache = cache.slice(0, 5);
          summaries.push(`Top cache entries: ${topCache.map(n => `"${n.label}" (importance ${n.importance.toFixed(2)})`).join(", ")}.`);
        }

        const now = Date.now();
        const captureContent = JSON.stringify({
          timestamp: new Date(now).toISOString(),
          sessionId,
          workingCache: cache.map(n => ({ id: n.id, label: n.label, importance: n.importance, content: n.content })),
        });

        await store.createNode({
          scope: "project",
          label: `middle-term:${sessionId}:${now}`,
          content: captureContent,
          type: "note",
          level: 0,
          parentIds: null,
          embedding: null,
          importance: 0.8,
          usefulnessScore: 0,
          metadata: { customType: "middle-term", sessionId, timestamp: now },
        });

        summaries.push(`Middle-term capture stored for session ${sessionId}.`);

        try {
          const typedClient = client as { session?: { messages: (opts: { path: { id: string }; query: { limit: number } }) => Promise<{ data?: Array<Record<string, unknown>>; [key: string]: unknown }> } };
          if (typedClient?.session?.messages) {
            const msgResponse = await typedClient.session.messages({ path: { id: sessionId }, query: { limit: 50 } });
            const messages: Array<{ info: Record<string, any>; parts: Array<Record<string, any>> }> =
              ((msgResponse?.data ?? msgResponse) as unknown as Array<{ info: Record<string, any>; parts: Array<Record<string, any>> }>) ?? [];
            if (Array.isArray(messages) && messages.length > 0) {
              const entries: string[] = [];

              // Record per-turn token usage
              let turnIndex = 0;
              for (const msg of messages) {
                if (msg.info?.role === "assistant" && msg.info?.tokens) {
                  const t = msg.info.tokens;
                  const modelStr = msg.info?.model
                    ? `${msg.info.model.providerID ?? ""}/${msg.info.model.modelID ?? ""}`
                    : null;
                  store.recordTokenUsage({
                    sessionId,
                    timestamp: msg.info?.time?.created ?? Date.now(),
                    inputTokens: t.input ?? 0,
                    outputTokens: t.output ?? 0,
                    reasoningTokens: t.reasoning ?? 0,
                    cacheReadTokens: t.cache?.read ?? 0,
                    cacheWriteTokens: t.cache?.write ?? 0,
                    cost: msg.info?.cost ?? 0,
                    turnIndex,
                    agent: msg.info?.agent ?? null,
                    model: modelStr,
                  }).catch(() => {});
                  turnIndex++;
                }
              }
              let totalSize = 0;
              const MAX_STORED = 12000;

              for (const msg of messages) {
                const role = msg.info?.role ?? "unknown";
                const agent = msg.info?.agent ?? "";
                const time = msg.info?.time?.created ? new Date(msg.info.time.created).toISOString() : "";

                let textContent = "";
                if (msg.parts && Array.isArray(msg.parts)) {
                  for (const part of msg.parts) {
                    if (part.type === "text" && part.text) {
                      textContent += part.text + "\n";
                    } else if (part.type === "reasoning" && part.text) {
                      textContent += `[reasoning] ${part.text.slice(0, 2000)}\n`;
                    } else if (part.type === "tool_use" && part.name) {
                      textContent += `[tool: ${part.name}${part.input ? ` ${JSON.stringify(part.input).slice(0, 200)}` : ""}]\n`;
                    } else if (part.type === "tool_result") {
                      const resultText = part.text ? part.text.slice(0, 500) : "";
                      textContent += `[result: ${part.isError ? "error" : "ok"}${resultText ? " " + resultText : ""}]\n`;
                    }
                  }
                }

                if (textContent) {
                  const entry = `[${time} ${role === "user" ? "User" : "Assistant"}${agent ? ` (${agent})` : ""}]\n${textContent.trim()}`;
                  if (totalSize + entry.length > MAX_STORED) {
                    entries.push(`[... truncated at ${MAX_STORED} chars ...]`);
                    break;
                  }
                  entries.push(entry);
                  totalSize += entry.length;
                }
              }

              if (entries.length > 0) {
                const nodeLabel = `storedcontext:${sessionId}:${now}`;
                const content = entries.join("\n\n---\n\n");
                let embedding: number[] | null = null;
                try { embedding = await generateEmbedding(content.slice(0, 8000)); } catch { embedding = null; }
                await store.createNode({
                  scope: "project",
                  label: nodeLabel,
                  content,
                  type: "storedcontext",
                  level: 0,
                  parentIds: null,
                  embedding,
                  importance: 3.0,
                  usefulnessScore: 0.5,
                  metadata: { customType: "storedcontext", sessionId, timestamp: now },
                });
                summaries.push(`Conversation archived as storedcontext node (label: ${nodeLabel}). Use memory_search with query or memory_recall_context to recall.`);
              }
            }
          }
        } catch { /* best-effort */ }

        out.context = summaries;

        if (config?.sessionLog?.enabled) {
          appendSessionLog(`[${new Date().toISOString()}] COMPACTING | id=${sessionId} | cache=${cache.length}`);
        }
      } catch (err) {
        memLog("error", "compaction", "Failed to capture middle-term context", { sessionId, error: String(err) });
        out.context = [];
      }
    },
  };
}
