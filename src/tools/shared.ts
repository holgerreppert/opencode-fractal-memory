import type { MemoryScope, MemoryStore } from "../storage/sqlite";
import type { MemoryNode } from "../memory";
import { estimateTokens } from "../infrastructure/llm/embeddings";

export const CONTEXT_LIMIT = 128000;
export const WARN_THRESHOLD = 0.8;
export const MAX_RECENT_CALLS = 50;

export const recentCalls: string[] = [];
export let pruneCallCounter = 0;
export const lastSearchResults: Array<{ id: string; label: string | undefined; scope: MemoryScope }> = [];

export async function resolveNode(
  store: MemoryStore,
  args: { id?: string | undefined; label?: string | undefined; scope?: string | undefined }
): Promise<MemoryNode> {
  if (args.id) {
    try {
      return await store.getNode(args.id);
    } catch { /* Try prefix fallback */
      const prefixNode = await store.getNodeByPrefix(args.id);
      if (prefixNode) {
        return prefixNode;
      }
      throw new Error(`Memory node not found: ${args.id}`);
    }
  }
  if (args.label) {
    const scope = (args.scope ?? "project") as MemoryScope;
    return await store.getNodeByLabel(scope, args.label);
  }
  throw new Error("Must provide either id or label");
}

export function wrapWithContextWarning(result: string, extraTokens = 0): string {
  const tokens = estimateTokens(result) + extraTokens;
  const ratio = tokens / CONTEXT_LIMIT;
  
  if (ratio >= WARN_THRESHOLD) {
    return result + `\n\n---\n⚠️ Context at ${(ratio * 100).toFixed(0)}% (~${tokens.toLocaleString()} tokens). Run memory(mode="compress") to create summaries.`;
  }
  
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapWithTracking(toolDef: any, store: MemoryStore | undefined | null, toolName: string): typeof toolDef {
  if (!store) return toolDef;
  const originalExecute = toolDef.execute;
  if (!originalExecute) return toolDef;

  toolDef.execute = async (...args: unknown[]) => {
    let contextWarning: boolean;
    let result: unknown;
    const startTime = performance.now();

    try {
      result = await originalExecute(...args);
      const durationMs = performance.now() - startTime;
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      const tokens = estimateTokens(resultStr);
      contextWarning = tokens / CONTEXT_LIMIT >= WARN_THRESHOLD;

      recentCalls.push(toolName);
      if (recentCalls.length > MAX_RECENT_CALLS) {
        recentCalls.shift();
      }

      pruneCallCounter++;
      if (pruneCallCounter >= 100) {
        pruneCallCounter = 0;
        try {
          await store.pruneUsageLog();
        } catch { /* ignore */ }
      }

      await store.logToolCall(toolName, tokens, contextWarning, true, durationMs);
    } catch (err) {
      const durationMs = performance.now() - startTime;
      await store.logToolCall(toolName, 0, false, false, durationMs).catch(() => { /* empty */ });
      throw err;
    }

    return result;
  };

  return toolDef;
}