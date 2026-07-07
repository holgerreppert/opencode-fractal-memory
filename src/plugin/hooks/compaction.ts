import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog, appendSessionLog } from "../../logging";
import { generateEmbedding } from "../../infrastructure/llm/embeddings";
import { getWorkingCache, addToWorkingCache } from "../../application/cache";
import type { HookHandler } from "./types";

function extractToolUse(entries: string[]): string[] {
  const tools = new Set<string>();
  for (const entry of entries) {
    const m = entry.match(/\[tool: (\w+)/);
    if (m) tools.add(m[1]!);
  }
  return [...tools].sort();
}

function extractFilePaths(entries: string[], toolNames: string[]): string[] {
  const files = new Set<string>();
  for (const entry of entries) {
    for (const tool of toolNames) {
      const re = new RegExp(`\\[tool: ${tool}[^\\]]*?"(filePath|path)":"([^"]+)"`);
      const m = entry.match(re);
      if (m?.[2]) files.add(m[2]);
    }
  }
  return [...files].sort();
}

function extractKeyErrors(entries: string[]): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (entry.includes("error") || entry.includes("fail") || entry.includes("exception")) {
      const lines = entry.split("\n").filter(l => /\b(error|fail|exception|cannot|not found)\b/i.test(l));
      for (const line of lines.slice(0, 3)) {
        const clean = line.replace(/^\[.*?\]\s*/, "").slice(0, 150);
        if (clean && !errors.includes(clean)) errors.push(clean);
      }
    }
  }
  return errors.slice(0, 5);
}

function extractTokenSummary(messages: Array<Record<string, unknown>>): string {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let agentCount = 0;
  for (const msg of messages) {
    const info = msg.info as Record<string, unknown> | undefined;
    const tokens = info?.tokens as Record<string, unknown> | undefined;
    if (tokens) {
      totalInput += (tokens.input as number) ?? 0;
      totalOutput += (tokens.output as number) ?? 0;
    }
    totalCost += (info?.cost as number) ?? 0;
    if (info?.agent) agentCount++;
  }
  return `input=${totalInput} output=${totalOutput} cost=${totalCost.toFixed(4)} agents=${agentCount}`;
}

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
            type ChatMessage = {
              info?: {
                role?: string;
                tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
                model?: { providerID?: string; modelID?: string };
                cost?: number;
                agent?: string | null;
                time?: { created?: number };
              };
              parts?: Array<{ type?: string; text?: string; name?: string; input?: unknown; isError?: boolean }>;
            };
            const messages: ChatMessage[] =
              ((msgResponse?.data ?? msgResponse) as unknown as ChatMessage[]) ?? [];
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
                  }).catch(() => { /* empty */ });
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
                // Generate structured summary
                const structured: Record<string, unknown> = {
                  session_id: sessionId,
                  timestamp: new Date(now).toISOString(),
                  turn_count: turnIndex,
                  tools_used: extractToolUse(entries),
                  files_modified: extractFilePaths(entries, ["edit", "write", "create"]),
                  key_errors: extractKeyErrors(entries),
                  token_usage: extractTokenSummary(messages),
                };
                const structuredYaml = Object.entries(structured)
                  .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
                  .map(([k, v]) => {
                    if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${String(i).replace(/\n/g, "\\n")}`).join("\n")}`;
                    return `${k}: ${String(v)}`;
                  })
                  .join("\n");

                const nodeLabel = `storedcontext:${sessionId}:${now}`;
                const content = `--- storedcontext summary ---\n${structuredYaml}\n--- conversation history ---\n\n${entries.join("\n\n---\n\n")}`;
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
                  importance: 0.5,
                  usefulnessScore: 0.1,
                  metadata: { customType: "storedcontext", sessionId, timestamp: now, turnCount: turnIndex },
                });
                summaries.push(`Conversation archived as storedcontext node with structured summary (label: ${nodeLabel}).`);
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
