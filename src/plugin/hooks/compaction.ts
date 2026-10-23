import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog, appendSessionLog } from "../../logging";
import { getWorkingCache, addToWorkingCache } from "../../application/cache";
import type { CompactionEvent, PluginHooks } from "./types";
import type { SessionApi } from "../session-api";

function isExcludedSnapshotLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  return label.startsWith("middle-term:") || label.startsWith("storedcontext:");
}

export function createCompactionHandler(store: MemoryStore, config: MemConfig, session: SessionApi): PluginHooks {
  return {
    "compaction": async (event: CompactionEvent) => {
      const input = event as unknown as { sessionID: string };
      const out = event as unknown as { context: string[]; prompt?: string };
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
              .filter(n => n.createdAt && !isExcludedSnapshotLabel(n.label))
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

        try {
          {
            type ChatMessage = {
              id?: string;
              role?: string;
              tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
              metadata?: {
                model?: { providerID?: string; modelID?: string };
                cost?: number;
                agent?: string | null;
                timeCreated?: number;
              };
              parts?: Array<{ type?: string; text?: string; name?: string; input?: unknown; isError?: boolean }>;
            };
            const chatMessages = (await session.messages({ sessionID: sessionId })) as unknown as ChatMessage[];
            if (Array.isArray(chatMessages) && chatMessages.length > 0) {
              // Record per-turn token usage
              let turnIndex = 0;
              for (const msg of chatMessages) {
                if (msg.role === "assistant" && msg.tokens) {
                  const t = msg.tokens;
                  const modelStr = msg.metadata?.model
                    ? `${msg.metadata.model.providerID ?? ""}/${msg.metadata.model.modelID ?? ""}`
                    : null;
                  store.recordTokenUsage({
                    sessionId,
                    timestamp: msg.metadata?.timeCreated ?? Date.now(),
                    inputTokens: t.input ?? 0,
                    outputTokens: t.output ?? 0,
                    reasoningTokens: t.reasoning ?? 0,
                    cacheReadTokens: t.cache?.read ?? 0,
                    cacheWriteTokens: t.cache?.write ?? 0,
                    cost: msg.metadata?.cost ?? 0,
                    turnIndex,
                    agent: msg.metadata?.agent ?? null,
                    model: modelStr,
                  }).catch(() => { /* empty */ });
                  turnIndex++;
                }
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
