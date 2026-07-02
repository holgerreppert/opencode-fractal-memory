import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { estimateTokens } from "../infrastructure/llm/embeddings";
import { wrapWithTracking } from "./shared";

const CONTEXT_LIMIT = 128000;
const MAX_INJECTION_TOKENS = 8000;
const HIGH_CONTEXT_THRESHOLD = 0.6;
const CRITICAL_CONTEXT_THRESHOLD = 0.8;

export function MemoryInjectionDebug(store: MemoryStore) {
  const t = tool({
    description: "Show selected memory node IDs and token usage for the last injection (no side‑effects).",
    args: {
      session_id: tool.schema.string().optional().describe("Session ID – defaults to current session"),
    },
    async execute(_args, _toolCtx) {
      const nodes = await store.listNodes("all");

      const totalTokens = nodes.reduce((sum, n) => sum + estimateTokens(n.content), 0);
      const contextPercent = totalTokens / CONTEXT_LIMIT;

      const coreNodes = nodes.filter(
        (n) => n.sticky || n.importance >= 0.9 || (n.scope === "global" && (n.type === "core" || n.label?.includes("persona") || n.label?.includes("preference")))
      );

      const isCritical = contextPercent >= CRITICAL_CONTEXT_THRESHOLD;
      const initialSelected = isCritical ? coreNodes.slice(0, 5) : [...coreNodes];
      const budget = isCritical ? 2000 : MAX_INJECTION_TOKENS;

      let injectionTokens = initialSelected.reduce((s, n) => s + estimateTokens(n.content), 0);
      const selected: typeof nodes = [...initialSelected];

      if (!isCritical || injectionTokens < budget) {
        for (const n of nodes) {
          if (selected.includes(n)) continue;
          const tkn = estimateTokens(n.content);
          if (injectionTokens + tkn > budget) break;
          selected.push(n);
          injectionTokens += tkn;
        }
      }

      const mode = isCritical ? "critical" : contextPercent >= HIGH_CONTEXT_THRESHOLD ? "high" : "normal";

      const result = {
        mode,
        contextPercent: contextPercent.toFixed(3),
        selectedCount: selected.length,
        injectionTokens,
        budget: MAX_INJECTION_TOKENS,
        nodeIds: selected.map((n) => n.id),
      };

      return JSON.stringify(result, null, 2);
    },
  });

  return wrapWithTracking(t, store, "memory_injection_debug");
}
