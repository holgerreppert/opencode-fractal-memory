import type { MemoryStore } from "../../storage/sqlite";
import { addToWorkingCache } from "../../application/cache";
import type { HookHandler } from "./types";

export function createWorkingCacheHandler(_store: MemoryStore): HookHandler {
  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; sessionID?: string; args?: Record<string, unknown> };
      const out = output as { output?: string; metadata?: Record<string, unknown> };

      if (!input.tool?.startsWith("memory_")) return;
      if (out.metadata?.error !== undefined) return;

      const sessionId = input.sessionID ?? "unknown";
      const args = input.args || {};
      const toolName = input.tool;

      try {
        if (toolName === "memory_fetch" && args.label) {
          const raw = out.output;
          if (typeof raw === "string") {
            const parsed = JSON.parse(raw);
            if (parsed?.success && parsed.node) {
              addToWorkingCache(sessionId, {
                id: parsed.node.id,
                label: parsed.node.label,
                content: parsed.node.content ?? "",
                importance: parsed.node.importance ?? 0.5,
              });
            }
          }
        } else if (toolName === "memory_get" && args.label) {
          addToWorkingCache(sessionId, {
            id: (args.id as string) ?? "",
            label: args.label as string,
            content: (out.output ?? "") as string,
            importance: 0.5,
          });
        } else if (toolName === "memory_drilldown" && (args.id || args.label)) {
          addToWorkingCache(sessionId, {
            id: (args.id as string) ?? "",
            label: ((args.label ?? args.id) as string),
            content: (out.output ?? "") as string,
            importance: 0.5,
          });
        } else if ((toolName === "memory_set" || toolName === "memory_replace") && args.label) {
          addToWorkingCache(sessionId, {
            id: "",
            label: args.label as string,
            content: (args.content ?? out.output ?? "") as string,
            importance: (args.importance as number) ?? 0.5,
          });
        } else if (toolName === "memory_search") {
          addToWorkingCache(sessionId, {
            id: "",
            label: `search:${((args.query ?? "") as string).slice(0, 40)}`,
            content: (out.output ?? "") as string,
            importance: 0.4,
          });
        }
      } catch {
        // best-effort
      }
    },
  };
}
