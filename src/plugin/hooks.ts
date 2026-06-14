import type { MemoryStore, MemoryScope } from "../storage/sqlite";
import type { MemConfig } from "../config";
import { memLog, memLogSimple, setSessionId } from "../logging";
import { generateFileSummary, generateFileLabel, SOURCE_FILE_EXTENSIONS } from "../file-summary";
import { distillRules, runConsolidation, predictiveRateToolCall, applyScoreDecay } from "../hooks";
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
          (output as { output?: string }).output = cached.content;
          (output as { metadata?: Record<string, unknown> }).metadata = {
            ...((output as { metadata?: Record<string, unknown> }).metadata ?? {}),
            cached: true,
          };
          memLogSimple(`FILE-CACHE-HIT: ${filePath} (${cached.content.length} chars)`, {
            label: shortLabel,
          });
        } else {
          memLogSimple(`FILE-CACHE-MISS: ${filePath}`, { label: shortLabel });
        }
      } catch (err) {
        memLog("warn", "file-summary", "Cache lookup failed", { error: String(err) });
      }
    },
    "tool.execute.after": async (input: any, output: any) => {
      if (input.tool?.startsWith("memory_")) {
        await store.recordMemoryToolCall(
          (input as any).sessionID ?? "unknown",
          input.tool,
          (input as any).args
        );
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
          fullContent = fs.readFileSync(filePath, "utf-8");
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
      } catch (err) {
        memLog("warn", "file-summary", "Failed to store file memory", { error: String(err) });
      }
    },
    event: async (input: { event: { type: string; properties: Record<string, unknown> } }) => {
      const { type, properties } = input.event;

      if (type === "session.created") {
        const sessionId = (properties.info as { id?: string } | undefined)?.id ?? "unknown";
        await store.createSessionMetrics(sessionId);
        setSessionId(sessionId);
        activeSessionCount++;
        managementServer.start();
      } else if (type === "session.idle") {
        const sessionId = (properties.sessionID as string | undefined) ?? "unknown";
        await store.updateSessionMetrics(sessionId, { endedAt: Date.now(), status: "completed" });

        if (memConfig?.autoDistill?.enabled) {
          distillRules(store, memConfig.autoDistill, sessionId, client).then(msg =>
            memLog("info", "auto-distill", msg)
          ).catch(err =>
            memLog("error", "auto-distill", "Failed", { error: String(err) })
          );
        }

        if (memConfig?.autoConsolidate?.enabled) {
          runConsolidation(store, memConfig.autoConsolidate, sessionId).then(msg =>
            memLog("info", "consolidation", msg)
          ).catch(err =>
            memLog("error", "consolidation", "Failed", { error: String(err) })
          );
        }

        if (memConfig?.predictiveRating?.enabled) {
          applyScoreDecay(store, memConfig.predictiveRating).then(msg =>
            memLog("info", "predictive-rating", msg)
          ).catch(err =>
            memLog("error", "predictive-rating", "Decay failed", { error: String(err) })
          );
        }
      } else if (type === "session.deleted") {
        activeSessionCount = Math.max(0, activeSessionCount - 1);
        if (activeSessionCount === 0) {
          managementServer.stop();
        }
      }
    },
  };
}
