import type { MemoryStore, MemoryScope } from "../storage/sqlite";
import type { MemConfig } from "../config";
import { memLog, memLogSimple, setSessionId } from "../logging";
import { generateFileSummary, generateFileLabel, SOURCE_FILE_EXTENSIONS } from "../file-summary";
import { distillRules, predictiveRateToolCall, applyScoreDecay } from "../hooks";
import * as fs from "node:fs";
import type { CachedMemoryNode } from "../cache";

export function createHookHandlers(
  store: MemoryStore,
  client: unknown,
  memConfig: MemConfig,
  ruleCache: Map<string, { content: string; type: string }>,
  ruleCacheDirty: { value: boolean },
  sessionInjectionLock: Map<string, boolean>,
  latestUserMessage: { value: string },
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
        const nodes = await store.listNodes("project");
        const cached = nodes.find(n => n.label === shortLabel);

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

        const nodes = await store.listNodes("project");
        const exists = nodes.some(n => n.label === shortLabel);

        if (exists) {
          memLog("debug", "file-summary", "File memory already exists, skipping", { shortLabel });
          return;
        }

        let fullContent = "";
        try {
          fullContent = fs.readFileSync(filePath, "utf-8");
        } catch (err) {
          memLog("warn", "file-summary", "Could not read full file, using tool output", { filePath, error: String(err) });
          fullContent = String(output.output ?? "");
        }

        const content = generateFileSummary(fileName, filePath, fullContent, fileExt);
        await store.createNode({
          scope: "project",
          label: shortLabel,
          content,
          type: "note",
          level: 0,
          parentIds: null,
          embedding: null,
          importance: 0.7,
        });
        memLog("info", "file-summary", "Stored file memory", { label: shortLabel, fileName });
      } catch (err) {
        memLog("warn", "file-summary", "Failed to store file memory", { error: String(err) });
      }
    },
    "session.created": async (event: { properties?: { info?: { id?: string } } }) => {
      const sessionId = event.properties?.info?.id ?? "unknown";
      await store.createSessionMetrics(sessionId);
      setSessionId(sessionId);
    },
    "session.idle": async (event: { properties?: { sessionID?: string } }) => {
      const sessionId = event.properties?.sessionID ?? "unknown";
      await store.updateSessionMetrics(sessionId, { endedAt: Date.now(), status: "completed" });

      if (memConfig?.autoDistill?.enabled) {
        distillRules(store, memConfig.autoDistill, sessionId, client).then(msg =>
          memLog("info", "auto-distill", msg)
        ).catch(err =>
          memLog("error", "auto-distill", "Failed", { error: String(err) })
        );
      }

      if (memConfig?.predictiveRating?.enabled) {
        applyScoreDecay(store, memConfig.predictiveRating).then(msg =>
          memLog("info", "predictive-rating", msg)
        ).catch(err =>
          memLog("error", "predictive-rating", "Decay failed", { error: String(err) })
        );
      }
    },
  };
}
