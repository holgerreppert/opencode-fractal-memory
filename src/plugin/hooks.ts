import type { MemoryStore, MemoryScope } from "../storage/sqlite";
import type { MemConfig } from "../config";
import { memLog, memLogSimple, setSessionId, appendSessionLog } from "../logging";
import { generateFileSummary, generateFileLabel, SOURCE_FILE_EXTENSIONS } from "../file-summary";
import { generateEmbedding } from "../embeddings";
import { distillRules, runConsolidation, predictiveRateToolCall, applyScoreDecay } from "../hooks";
import { getWorkingCache, addToWorkingCache, clearWorkingCache } from "../cache";
import { cleanupMiddleTermCaptures } from "./state";
import * as fs from "node:fs";
import type { CachedMemoryNode } from "../cache";

let activeSessionCount = 0;

export function createHookHandlers(
  store: MemoryStore,
  client: unknown,
  memConfig: MemConfig,
  ruleCache: Map<string, { content: string; type: string }>,
  ruleCacheDirty: { value: boolean },
  sessionInjectionLock: Map<string, boolean>,
  latestUserMessage: { value: string },
  managementServer: { start: () => void; stop: () => void },
) {
  return {
    "experimental.chat.system.transform": async (input: any, output: any) => {
      const sessionId = (input as any).sessionID ?? `session-${Date.now()}`;
      setSessionId(sessionId);

      if (sessionInjectionLock.get(sessionId)) return;
      sessionInjectionLock.set(sessionId, true);

      const reminders: string[] = [];
      try {
        if (ruleCacheDirty.value || ruleCache.size === 0) {
          const ruleLabels = [
            { label: "rule:mandatory:memory", type: "mandatory" },
            { label: "rule:mandatory:core", type: "mandatory" },
            { label: "rule:mandatory:agent-pull", type: "mandatory" },
            { label: "rule:mandatory:tools", type: "mandatory" },
            { label: "rule:standard", type: "standard" },
            { label: "rule:suggestion", type: "suggestion" },
          ];

          for (const { label, type } of ruleLabels) {
            let node = null;
            for (const scope of ["global", "project"] as MemoryScope[]) {
              try { node = await store.getNodeByLabel(scope, label); break; } catch { /* ignore */ }
            }
            if (node) {
              let content = node.content || "";
              content = content.replace(/^## .*$/gm, "").replace(/^tag:.*$/gm, "").trim();
              if (content) ruleCache.set(label, { content, type });
            }
          }
          ruleCacheDirty.value = false;
        }

        for (const [label, cached] of ruleCache) {
          if (cached.type === "mandatory" || cached.type === "standard") {
            reminders.push(`<system_reminder type="${cached.type}">\n${cached.content}\n</system_reminder>`);
          }
        }

        if (reminders.length > 0) {
          const insertAt = output.system.length > 0 ? 1 : 0;
          output.system.splice(insertAt, 0, reminders.join("\n\n"));
        }
      } catch (err) {
        memLog("error", "injection", "Rule injection failed", { error: String(err) });
      }

      output.system = output.system.map((part: string) =>
        part.replace(/<available_skills>[\s\S]*?<\/available_skills>/g, "")
      );

      sessionInjectionLock.delete(sessionId);

      if (memConfig?.sessionLog?.enabled) {
        const mandatory = [...ruleCache.values()].filter(r => r.type === "mandatory").length;
        const standard = [...ruleCache.values()].filter(r => r.type === "standard").length;
        const suggestion = [...ruleCache.values()].filter(r => r.type === "suggestion").length;
        appendSessionLog(`[${new Date().toISOString()}] SYSTEM TRANSFORM | id=${sessionId} | rules=${ruleCache.size} | mandatory=${mandatory} standard=${standard} suggestion=${suggestion}`);
      }
    },
    "tool.execute.before": async (input: any, output: any) => {
      const fileSummarization = memConfig?.autoFileSummarization;
      if (!fileSummarization?.enabled) return;
      if (input.tool !== "read") return;
      const toolInput = input as { tool: string; args?: Record<string, unknown> };
      if (!toolInput.args?.filePath) return;

      const filePath = toolInput.args.filePath as string;
      const fileExt = filePath.split('.').pop() ?? "";

      if (!SOURCE_FILE_EXTENSIONS.includes(fileExt)) return;

      try {
        const shortLabel = generateFileLabel(filePath);
        let cached = null;
        try { cached = await store.getNodeByLabel("project", shortLabel); } catch { /* not found */ }

        if (cached) {
          let isStale = false;
          try {
            const fileMtime = (await fs.promises.stat(filePath)).mtime;
            if (fileMtime.getTime() > cached.updatedAt.getTime()) {
              isStale = true;
            }
          } catch {
            /* stat failed — serve cache anyway */
          }

          if (isStale) {
            memLogSimple(`FILE-CACHE-STALE: ${filePath} (file newer than cache)`, { label: shortLabel });
            if (memConfig?.sessionLog?.enabled) {
              appendSessionLog(`[${new Date().toISOString()}] FILE SUMMARIZE | id=${(input as any).sessionID ?? "unknown"} | path=${filePath} | label=${shortLabel} | action=cached-stale`);
            }
          } else {
            (output as { output?: string }).output = cached.content;
            (output as { metadata?: Record<string, unknown> }).metadata = {
              ...((output as { metadata?: Record<string, unknown> }).metadata ?? {}),
              cached: true,
            };
            memLogSimple(`FILE-CACHE-HIT: ${filePath} (${cached.content.length} chars)`, {
              label: shortLabel,
            });
            if (memConfig?.sessionLog?.enabled) {
              appendSessionLog(`[${new Date().toISOString()}] FILE SUMMARIZE | id=${(input as any).sessionID ?? "unknown"} | path=${filePath} | label=${shortLabel} | action=cached-hit`);
            }
          }
        } else {
          memLogSimple(`FILE-CACHE-MISS: ${filePath}`, { label: shortLabel });
          if (memConfig?.sessionLog?.enabled) {
            appendSessionLog(`[${new Date().toISOString()}] FILE SUMMARIZE | id=${(input as any).sessionID ?? "unknown"} | path=${filePath} | label=${shortLabel} | action=cached-miss`);
          }
        }
      } catch (err) {
        memLog("warn", "file-summary", "Cache lookup failed", { error: String(err) });
      }
    },
    "tool.execute.after": async (input: any, output: any) => {
      const sessionId = (input as any).sessionID ?? "unknown";

      if (input.tool?.startsWith("memory_")) {
        await store.recordMemoryToolCall(
          sessionId,
          input.tool,
          (input as any).args
        );

        // Populate working cache from memory tool results
        if (output.metadata?.error === undefined) {
          try {
            const args = (input as any).args || {};
            const toolName = input.tool;

            const toolLabel = (args.label ?? args.id ?? "").toString();
            if (toolName === "memory_fetch" && args.label) {
              const raw = output.output;
              if (typeof raw === "string") {
                const parsed = JSON.parse(raw);
                if (parsed?.success && parsed.node) {
                  addToWorkingCache(sessionId, {
                    id: parsed.node.id,
                    label: parsed.node.label,
                    content: parsed.node.content ?? "",
                    importance: parsed.node.importance ?? 0.5,
                  });
                  memLog("debug", "working-cache", `memory_fetch → cache "${parsed.node.label}"`, { sessionId, label: parsed.node.label, contentLength: (parsed.node.content ?? "").length, content: (parsed.node.content ?? "").slice(0, 2000) });
                }
              }
            } else if (toolName === "memory_get" && args.label) {
              addToWorkingCache(sessionId, {
                id: args.id ?? "",
                label: args.label,
                content: output.output ?? "",
                importance: 0.5,
              });
              memLog("debug", "working-cache", `memory_get → cache "${args.label}"`, { sessionId, label: args.label, contentLength: ((output.output ?? "") as string).length, content: (output.output ?? "").slice(0, 2000) });
            } else if (toolName === "memory_drilldown" && (args.id || args.label)) {
              addToWorkingCache(sessionId, {
                id: args.id ?? "",
                label: args.label ?? args.id,
                content: output.output ?? "",
                importance: 0.5,
              });
              memLog("debug", "working-cache", `memory_drilldown → cache "${toolLabel}"`, { sessionId, label: toolLabel, contentLength: ((output.output ?? "") as string).length, content: (output.output ?? "").slice(0, 2000) });
            } else if ((toolName === "memory_set" || toolName === "memory_replace") && args.label) {
              addToWorkingCache(sessionId, {
                id: "",
                label: args.label,
                content: args.content ?? output.output ?? "",
                importance: args.importance ?? 0.5,
              });
              memLog("debug", "working-cache", `${toolName} → cache "${args.label}"`, { sessionId, label: args.label, contentLength: (args.content ?? "").length, content: (args.content ?? "").slice(0, 2000) });
            } else if (toolName === "memory_search") {
              addToWorkingCache(sessionId, {
                id: "",
                label: `search:${(args.query ?? "").slice(0, 40)}`,
                content: output.output ?? "",
                importance: 0.4,
              });
              memLog("debug", "working-cache", `memory_search → cache`, { sessionId, query: (args.query ?? "").slice(0, 80), resultsLength: ((output.output ?? "") as string).length });
            }
          } catch {
            // Cache population is best-effort
          }
        }
      }

      const success = output.metadata?.error ? false : true;

      if (memConfig?.predictiveRating?.enabled && input.tool?.startsWith("memory_")) {
        predictiveRateToolCall(store, input as any, output as any, memConfig.predictiveRating).catch(err =>
          memLog("warn", "predictive-rating", "Rating failed", { error: String(err) })
        );
      }

      if (!success) return;

      const fileSummarization = memConfig?.autoFileSummarization;
      if (!fileSummarization?.enabled) return;
      if (input.tool !== "read") return;
      const toolInput = input as { tool: string; args?: Record<string, unknown> };
      if (!toolInput.args?.filePath) return;

      const isCached = (output.metadata as { cached?: boolean } | undefined)?.cached === true;
      if (isCached) return;

      const filePath = toolInput.args.filePath as string;
      const fileName = filePath.split('/').pop() ?? filePath;
      const fileExt = fileName.split('.').pop() ?? "";

      if (!SOURCE_FILE_EXTENSIONS.includes(fileExt)) return;

      try {
        const shortLabel = generateFileLabel(filePath);

        let existingNode = null;
        try { existingNode = await store.getNodeByLabel("project", shortLabel); } catch { /* not found */ }

        let fullContent = "";
        try {
          fullContent = await fs.promises.readFile(filePath, "utf-8");
        } catch (err) {
          memLog("warn", "file-summary", "Could not read full file, using tool output", { filePath, error: String(err) });
          fullContent = String(output.output ?? "");
        }

        const content = generateFileSummary(fileName, filePath, fullContent, fileExt);

        if (existingNode) {
          await store.updateNode(existingNode.id, { content });
          memLog("debug", "file-summary", "Updated file memory", { label: shortLabel, fileName });
        } else {
          try {
            await store.createNode({
              scope: "project",
              label: shortLabel,
              content,
              type: "note",
              level: 0,
              parentIds: null,
              embedding: null,
              importance: 0.7,
              usefulnessScore: 0.3,
            });
            memLog("info", "file-summary", "Stored file memory", { label: shortLabel, fileName });
          } catch (createErr) {
            const errMsg = String(createErr);
            if (errMsg.includes("UNIQUE constraint")) {
              try {
                const fallback = await store.getNodeByLabel("project", shortLabel);
                await store.updateNode(fallback.id, { content });
                memLog("debug", "file-summary", "Recovered from race: updated file memory", { label: shortLabel, fileName });
              } catch {
                memLog("warn", "file-summary", "Failed to recover from UNIQUE constraint", { label: shortLabel, error: errMsg });
              }
            } else {
              throw createErr;
            }
          }
        }

        if (memConfig?.sessionLog?.enabled) {
          const action = existingNode ? "updated" : "stored";
          appendSessionLog(`[${new Date().toISOString()}] FILE SUMMARIZE | id=${(input as any).sessionID ?? "unknown"} | path=${filePath} | label=${shortLabel} | action=${action}`);
        }
      } catch (err) {
        memLog("warn", "file-summary", "Failed to store file memory", { error: String(err) });
      }
    },
    "experimental.session.compacting": async (input: { sessionID: string }, output: { context: string[]; prompt?: string }) => {
      const sessionId = input.sessionID;
      if (!memConfig?.enableMiddleTermCapture) {
        output.context = [];
        memLog("debug", "compaction", "Compaction hook output (disabled)", { sessionId, outputContext: [], prompt: null });
        return;
      }

      try {
        let cache = getWorkingCache(sessionId);
        const summaries: string[] = [];

        // Fallback: if working cache is empty, pull recent nodes from the store
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
              memLog("debug", "compaction", "Store fallback populated working cache", { sessionId, fallbackCount: recent.length, entries: recent.map(n => ({ label: n.label, contentLength: (n.content ?? "").length, content: (n.content ?? "").slice(0, 1000) })) });
            }
          } catch {
            // Best-effort
          }
        }

        if (cache.length > 0) {
          summaries.push(`Working cache has ${cache.length} active entries.`);
          const topCache = cache.slice(0, 5);
          summaries.push(`Top cache entries: ${topCache.map(n => `"${n.label}" (importance ${n.importance.toFixed(2)})`).join(", ")}.`);
        }

        // Snapshot as sticky temporal node
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
        memLog("info", "compaction", "Middle-term capture created", { sessionId, cacheSize: cache.length, captureContent });

        // Store pruned conversation as storedcontext node for later recall
        try {
          const typedClient = client as any;
          if (typedClient?.session?.messages) {
            const msgResponse = await typedClient.session.messages({ path: { id: sessionId }, query: { limit: 50 } });
            const messages: Array<{ info: Record<string, any>; parts: Array<Record<string, any>> }> =
              msgResponse?.data ?? msgResponse ?? [];
            if (Array.isArray(messages) && messages.length > 0) {
              const entries: string[] = [];
              let totalSize = 0;
              const MAX_STORED = 12000;

              for (const msg of messages) {
                const role = msg.info?.role ?? "unknown";
                const agent = msg.info?.agent ?? "";
                const time = msg.info?.time?.created ? new Date(msg.info.time.created).toISOString() : "";
                const label = role === "user" ? "User" : "Assistant";

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
                  const entry = `[${time} ${label}${agent ? ` (${agent})` : ""}]\n${textContent.trim()}`;
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
                try {
                  embedding = await generateEmbedding(content.slice(0, 8000));
                } catch {
                  embedding = null;
                }
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
                memLog("info", "compaction", "Stored context archived", { sessionId, nodeLabel, messageCount: messages.length, charCount: totalSize, hasEmbedding: embedding !== null });
              }
            }
          }
        } catch (err) {
          memLog("debug", "compaction", "Stored context unavailable", { sessionId, error: String(err) });
        }

        output.context = summaries;
        memLog("info", "compaction", "Compaction hook output", { sessionId, outputContext: summaries, prompt: output.prompt ?? null });

        if (memConfig?.sessionLog?.enabled) {
          appendSessionLog(`[${new Date().toISOString()}] COMPACTING | id=${sessionId} | cache=${cache.length}`);
        }
      } catch (err) {
        memLog("error", "compaction", "Failed to capture middle-term context", { sessionId, error: String(err) });
        output.context = [];
        memLog("info", "compaction", "Compaction hook output (error)", { sessionId, outputContext: [], prompt: null });
      }
    },
    "experimental.compaction.autocontinue": async (_input: { sessionID: string }, output: { enabled: boolean }) => {
      // Let the auto-continue run by default; plugins with pending async work
      // can set enabled: false here to skip the synthetic "continue" message.
      output.enabled = true;
    },
    event: async (input: { event: { type: string; properties: Record<string, unknown> } }) => {
      const { type, properties } = input.event;

      const sl = () => memConfig?.sessionLog?.enabled;

      if (type === "session.created") {
        const sessionId = (properties.info as { id?: string } | undefined)?.id ?? "unknown";
        await store.createSessionMetrics(sessionId);
        setSessionId(sessionId);
        activeSessionCount++;
        managementServer.start();
        if (sl()) {
          const project = (properties.info as { projectName?: string } | undefined)?.projectName ?? "";
          appendSessionLog(`[${new Date().toISOString()}] SESSION CREATED | id=${sessionId} | project=${project}`);
        }
      } else if (type === "session.idle") {
        const sessionId = (properties.sessionID as string | undefined) ?? "unknown";
        await store.updateSessionMetrics(sessionId, { endedAt: Date.now(), status: "completed" });

        const tasks: string[] = [];

        if (memConfig?.autoDistill?.enabled) {
          distillRules(store, memConfig.autoDistill, sessionId, client).then(msg =>
            memLog("info", "auto-distill", msg)
          ).catch(err =>
            memLog("error", "auto-distill", "Failed", { error: String(err) })
          );
          tasks.push("distill");
        }

        if (memConfig?.autoConsolidate?.enabled) {
          runConsolidation(store, memConfig.autoConsolidate, sessionId).then(msg =>
            memLog("info", "consolidation", msg)
          ).catch(err =>
            memLog("error", "consolidation", "Failed", { error: String(err) })
          );
          tasks.push("consolidation");
        }

        if (memConfig?.predictiveRating?.enabled) {
          applyScoreDecay(store, memConfig.predictiveRating).then(msg =>
            memLog("info", "predictive-rating", msg)
          ).catch(err =>
            memLog("error", "predictive-rating", "Decay failed", { error: String(err) })
          );
          tasks.push("decay");
        }

        if (sl()) {
          const duration = (properties.activeDurationMs as number) ?? 0;
          const durStr = duration >= 60000 ? `${(duration / 60000).toFixed(0)}m` : `${(duration / 1000).toFixed(0)}s`;
          appendSessionLog(`[${new Date().toISOString()}] SESSION IDLE | id=${sessionId} | duration=${durStr} | tasks=${tasks.join(",") || "none"}`);
        }
      } else if (type === "session.deleted") {
        activeSessionCount = Math.max(0, activeSessionCount - 1);
        if (sl()) {
          const sessionId = (properties.sessionID as string) ?? "unknown";
          appendSessionLog(`[${new Date().toISOString()}] SESSION DELETED | id=${sessionId} | active=${activeSessionCount}`);
        }
        if (activeSessionCount === 0) {
          managementServer.stop();
        }
      } else if (type === "session.compacted") {
        const sessionId = (properties.sessionID as string) ?? "unknown";

        const tasks: string[] = [];

        try {
          const cleaned = await cleanupMiddleTermCaptures(store);
          if (cleaned > 0) tasks.push(`cleanup(${cleaned})`);
        } catch (err) {
          memLog("warn", "compaction", "Cleanup failed", { sessionId, error: String(err) });
        }

        if (memConfig?.predictiveRating?.enabled) {
          applyScoreDecay(store, memConfig.predictiveRating).then(msg => {
            memLog("info", "predictive-rating", msg);
          }).catch(err =>
            memLog("error", "predictive-rating", "Decay failed", { error: String(err) })
          );
          tasks.push("decay");
        }

        if (memConfig?.autoConsolidate?.enabled) {
          runConsolidation(store, memConfig.autoConsolidate, sessionId).then(msg =>
            memLog("info", "consolidation", msg)
          ).catch(err =>
            memLog("error", "consolidation", "Failed", { error: String(err) })
          );
          tasks.push("consolidation");
        }

        if (sl()) {
          appendSessionLog(`[${new Date().toISOString()}] COMPACTED | id=${sessionId} | tasks=${tasks.join(",") || "none"}`);
        }

        memLog("info", "compaction", "Post-compaction tasks completed", { sessionId, tasks: tasks.join(",") || "none" });
      }
    },
  };
}
