import type { MemoryStore, MemoryScope } from "../../storage/sqlite";
import type { MemConfig } from "../../config";
import { memLog, setSessionId, appendSessionLog } from "../../logging";
import type { HookHandler } from "./types";

const RULE_LABELS = [
  { label: "rule:mandatory:memory", type: "mandatory" },
  { label: "rule:mandatory:core", type: "mandatory" },
  { label: "rule:mandatory:agent-pull", type: "mandatory" },
  { label: "rule:mandatory:tools", type: "mandatory" },
  { label: "rule:standard", type: "standard" },
  { label: "rule:suggestion", type: "suggestion" },
  { label: "rule:feature:command-compression", type: "info" },
  { label: "rule:feature:file-skeletonization", type: "info" },
  { label: "rule:feature:file-summarization", type: "info" },
  { label: "rule:feature:auto-retrieve", type: "info" },
];

export function createSeedRulesHandler(
  store: MemoryStore,
  config: MemConfig,
  ruleCache: Map<string, { content: string; type: string }>,
  ruleCacheDirty: { value: boolean },
  sessionInjectionLock: Map<string, boolean>,
): HookHandler {
  return {
    "system.transform": async (_input: unknown, output: unknown) => {
      const input = _input as { sessionID?: string };
      const out = output as { system: string[] };
      const sessionId = input.sessionID ?? `session-${Date.now()}`;
      setSessionId(sessionId);

      if (sessionInjectionLock.get(sessionId)) return;
      sessionInjectionLock.set(sessionId, true);

      const reminders: string[] = [];
      try {
        if (ruleCacheDirty.value || ruleCache.size === 0) {
          for (const { label, type } of RULE_LABELS) {
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
          const allowed = ["mandatory", "standard", "suggestion", "info"];
          if (allowed.includes(cached.type)) {
            reminders.push(`<system_reminder type="${cached.type}">\n${cached.content}\n</system_reminder>`);
          }
        }

        if (reminders.length > 0) {
          const insertAt = out.system.length > 0 ? 1 : 0;
          out.system.splice(insertAt, 0, reminders.join("\n\n"));
        }
      } catch (err) {
        memLog("error", "injection", "Rule injection failed", { error: String(err) });
      }

      out.system = out.system.map((part: string) =>
        part.replace(/<available_skills>[\s\S]*?<\/available_skills>/g, "")
      );

      sessionInjectionLock.delete(sessionId);

      if (config?.sessionLog?.enabled) {
        const counts: Record<string, number> = {};
        for (const cached of ruleCache.values()) {
          counts[cached.type] = (counts[cached.type] ?? 0) + 1;
        }
        const parts = Object.entries(counts).map(([t, c]) => `${t}=${c}`).join(" ");
        appendSessionLog(`[${new Date().toISOString()}] SYSTEM TRANSFORM | id=${sessionId} | rules=${ruleCache.size} | ${parts}`);
      }
    },
  };
}
