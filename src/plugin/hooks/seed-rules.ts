import type { MemoryStore, MemoryScope } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
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

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9_#-]+/);
  const filtered = words.filter(w => w.length >= 3 && !["the", "and", "for", "are", "was", "but", "not", "you", "all", "can", "has", "had", "its", "how", "why", "what", "when", "where", "which", "will", "your", "from", "have", "that", "this", "with", "been", "some", "than", "then", "they", "them", "also", "just", "more", "most", "only", "over", "such", "each", "about", "into", "than", "very", "after", "other", "their", "there", "these", "those", "could", "would", "should"].includes(w));
  return new Set(filtered);
}

function scoreKeywordOverlap(userKeywords: Set<string>, ruleContent: string): number {
  const ruleKeywords = extractKeywords(ruleContent);
  if (ruleKeywords.size === 0 || userKeywords.size === 0) return 0;
  let overlap = 0;
  for (const kw of userKeywords) {
    if (ruleKeywords.has(kw)) overlap++;
  }
  return overlap / Math.sqrt(userKeywords.size * ruleKeywords.size);
}

export function createSeedRulesHandler(
  store: MemoryStore,
  config: MemConfig,
  ruleCache: Map<string, { content: string; type: string }>,
  ruleCacheDirty: { value: boolean },
  sessionInjectionLock: Map<string, boolean>,
): HookHandler {
  return {
    "system.transform": async (_input: unknown, output: unknown) => {
      const input = _input as { args?: Record<string, unknown>; sessionID?: string };
      const out = output as { system: string[] };
      const sessionId = input.sessionID ?? `session-${Date.now()}`;
      setSessionId(sessionId);

      if (sessionInjectionLock.get(sessionId)) return;
      sessionInjectionLock.set(sessionId, true);

      const reminders: string[] = [];
      const seenLabels = new Set<string>();

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

        const userMessage = input.args?.userMessage ? String(input.args.userMessage) : "";
        const userKeywords = userMessage ? extractKeywords(userMessage) : new Set<string>();
        const scoredRules: Array<{ label: string; content: string; type: string; score: number }> = [];

        for (const [label, cached] of ruleCache) {
          if (!["mandatory", "standard", "suggestion", "info"].includes(cached.type)) continue;
          if (seenLabels.has(label)) continue;
          seenLabels.add(label);

          const score = userKeywords.size > 0
            ? scoreKeywordOverlap(userKeywords, cached.content)
            : 1.0;

          scoredRules.push({ label, content: cached.content, type: cached.type, score });
        }

        scoredRules.sort((a, b) => b.score - a.score);

        for (const rule of scoredRules) {
          if (rule.type === "mandatory" || rule.score >= 0.15) {
            reminders.push(`<system_reminder type="${rule.type}">\n${rule.content}\n</system_reminder>`);
          }
        }

        if (reminders.length > 0) {
          const insertAt = out.system.length > 0 ? 1 : 0;
          out.system.splice(insertAt, 0, reminders.join("\n\n"));
        }

        if (reminders.length < ruleCache.size) {
          memLog("debug", "seed-rules", `Adaptive selection: ${reminders.length}/${ruleCache.size} rules injected`, {
            total: ruleCache.size,
            injected: reminders.length,
            userQueryLength: userMessage.length,
          });
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
        appendSessionLog(`[${new Date().toISOString()}] SYSTEM TRANSFORM | id=${sessionId} | rules=${reminders.length}/${ruleCache.size} | ${parts}`);
      }
    },
  };
}
