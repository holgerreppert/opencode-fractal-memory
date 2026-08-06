import type { MemoryStore, MemoryScope } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { injectionMarker, recordInjection } from "../../application/injection-visibility";
import { memLog, setSessionId, appendSessionLog } from "../../logging";
import type { HookHandler } from "./types";

const CROSS_SESSION_CACHE = new Map<string, string[]>();
let lastCrossSessionFetch = 0;

const RULE_LABELS = [
  { label: "rule:mandatory:memory", type: "mandatory" },
  { label: "rule:mandatory:core", type: "mandatory" },
  { label: "rule:mandatory:agent-pull", type: "mandatory" },
  { label: "rule:mandatory:tools", type: "mandatory" },
  { label: "rule:mandatory:what-to-store", type: "mandatory" },
  { label: "rule:standard", type: "standard" },
  { label: "rule:suggestion", type: "suggestion" },
  { label: "rule:feature:command-compression", type: "info" },
  { label: "rule:feature:file-skeletonization", type: "info" },
  { label: "rule:feature:auto-retrieve", type: "info" },
  { label: "rule:feature:tag-intersection-search", type: "info" },
  { label: "rule:feature:source-propagation", type: "info" },
  { label: "rule:feature:confidence-diminishing-returns", type: "info" },
  { label: "rule:feature:auto-lessons", type: "info" },
  { label: "rule:feature:auto-capture", type: "info" },
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

        // Progressive rule disclosure: at high context pressure, strip non-essential rules
        const pressureState = (globalThis as any).__pressureState as { phase: string; pct: number } | undefined;
        const pressurePct = pressureState?.pct ?? 0;
        const minScoreForRules = pressurePct >= 95 ? 0.50 :
                                 pressurePct >= 85 ? 0.30 :
                                 pressurePct >= 75 ? 0.20 :
                                 0.0;
        const allowStandard = pressurePct < 85;
        const allowSuggestion = pressurePct < 75;

        const neverStrip: Array<{ label: string; content: string; type: string }> = [];
        const scoredRules: Array<{ label: string; content: string; type: string; score: number }> = [];

        for (const [label, cached] of ruleCache) {
          if (!["mandatory", "standard", "suggestion", "info"].includes(cached.type)) continue;
          if (seenLabels.has(label)) continue;
          seenLabels.add(label);

          // C2: never_strip rules bypass pressure filtering entirely
          if (cached.content.includes("never_strip: true")) {
            neverStrip.push({ label, content: cached.content, type: cached.type });
            continue;
          }

          const score = userKeywords.size > 0
            ? scoreKeywordOverlap(userKeywords, cached.content)
            : 1.0;

          scoredRules.push({ label, content: cached.content, type: cached.type, score });
        }

        scoredRules.sort((a, b) => b.score - a.score);

        // C2: never_strip rules always injected, never filtered
        for (const { content, type } of neverStrip) {
          reminders.push(`<system_reminder type="${type}">\n${content}\n</system_reminder>`);
        }

        for (const { label: _label, content, type, score } of scoredRules) {
          if (type === "mandatory") {
            reminders.push(`<system_reminder type="${type}">\n${content}\n</system_reminder>`);
          } else if (type === "standard" && !allowStandard) {
            continue;
          } else if ((type === "suggestion" || type === "info") && !allowSuggestion) {
            continue;
          } else if (score >= Math.max(minScoreForRules, 0.15)) {
            reminders.push(`<system_reminder type="${type}">\n${content}\n</system_reminder>`);
          }
        }

        // C3: Front-load critical rules to the beginning of system[0]
        // Never-strip rules are prepended, normal rules appended
        if (reminders.length > 0) {
          const neverStripCount = neverStrip.length;
          const neverStripReminders = reminders.slice(0, neverStripCount);
          const normalReminders = reminders.slice(neverStripCount);

          const neverStripBlock = neverStripReminders.length > 0
            ? neverStripReminders.join("\n\n")
            : "";
          const normalBlock = normalReminders.length > 0
            ? normalReminders.join("\n\n")
            : "";

          if (out.system.length > 0) {
            // C3: Prepend never_strip rules to the very start of system[0]
            if (neverStripBlock) {
              out.system[0] = neverStripBlock + "\n\n" + out.system[0];
            }
            // Append normal rules at the end (existing behavior)
            if (normalBlock) {
              out.system[0] += "\n\n" + normalBlock;
            }
          } else {
            out.system.push([neverStripBlock, normalBlock].filter(Boolean).join("\n\n"));
          }

          const marker = injectionMarker(config, "seed-rules", `${reminders.length} rule(s) injected`);
          if (marker && out.system.length > 0) {
            out.system[0] += "\n\n" + marker;
          }
          recordInjection(config, "seed-rules", `${reminders.length} rule(s) (mandatory=${neverStrip.length}, adaptive=${scoredRules.length - neverStrip.length})`);
        }

        if (reminders.length < ruleCache.size) {
          memLog("debug", "seed-rules", `Adaptive selection: ${reminders.length}/${ruleCache.size} rules injected`, {
            total: ruleCache.size,
            injected: reminders.length,
            userQueryLength: userMessage.length,
            neverStrip: neverStrip.length,
          });
        }

        // Cross-session context injection
        if (userMessage.length >= 10) {
          try {
            const now = Date.now();
            if (now - lastCrossSessionFetch > 60000) {
              lastCrossSessionFetch = now;
              const { searchNodes } = await import("../../application/search");
              const { generateEmbedding } = await import("../../infrastructure/llm/embeddings");
              const priors = (await searchNodes(store, generateEmbedding, userMessage, {
                limit: 10,
                scope: "all",
              }))
                .filter(n => n.type === "storedcontext")
                .slice(0, 3);
              if (priors.length > 0) {
                const snippets: string[] = [];
                const seenLabels = new Set<string>();
                for (const n of priors) {
                  if (seenLabels.has(n.label ?? "")) continue;
                  seenLabels.add(n.label ?? "");
                  const content = n.content ?? "";
                  const summaryMatch = content.match(/--- storedcontext summary ---\n([\s\S]*?)--- conversation history ---/);
                  const summary = summaryMatch ? summaryMatch[1]!.trim() : content.slice(0, 300);
                  snippets.push(`<session reference="${n.label ?? "prior"}">\n${summary.slice(0, 500)}\n</session>`);
                }
                if (snippets.length > 0) {
                  CROSS_SESSION_CACHE.set(sessionId, snippets);
                }
              }
            }

            const cachedSnippets = CROSS_SESSION_CACHE.get(sessionId);
            if (cachedSnippets && cachedSnippets.length > 0) {
              const crossSessionBlock = `<system_reminder type="info">\n<prior_sessions>\n${cachedSnippets.join("\n")}\n</prior_sessions>\n</system_reminder>`;
              if (out.system.length > 0) {
                out.system[0] += "\n\n" + crossSessionBlock;
              } else {
                out.system.push(crossSessionBlock);
              }
              recordInjection(config, "cross-session-context", `${cachedSnippets.length} prior session snippet(s)`);
              memLog("debug", "seed-rules", `Injected ${cachedSnippets.length} cross-session context snippets`, {
                sessionId,
                snippets: cachedSnippets.length,
              });
            }
          } catch { /* best-effort */ }
        }
      } catch (err) {
        memLog("error", "injection", "Rule injection failed", { error: String(err) });
      }

      out.system = out.system.map((part: string) =>
        part.replace(/<available_skills>[\s\S]*?<\/available_skills>/g, "")
      );

      // C4: Recency-end tool decision tree — always injected at array end for max recency
      const TOOL_DECISION_TREE = `<system_reminder type="mandatory">
## Tool Decision Guide
Exploring code (read/grep/glob) → memory(mode="search") first (100× cheaper)
Editing code (edit/write) → graph(relation="callers") first
Complex task (3+ steps) → context(mode="check") then context(mode="inject")
After discovery → memory(mode="set") + learn(mode="verify")
</system_reminder>`;
      out.system.push(TOOL_DECISION_TREE);

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
