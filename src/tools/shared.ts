import type { MemoryScope, MemoryStore } from "../storage/sqlite";
import type { MemoryNode } from "../memory";
import { estimateTokens } from "../infrastructure/llm/embeddings";
import { trigramJaccard } from "../application/command-compression/dedup";

export const CONTEXT_LIMIT = 128000;
export const WARN_THRESHOLD = 0.8;
export const MAX_RECENT_CALLS = 50;
const TOKEN_CAP_CHARS = 2000;

export const recentCalls: string[] = [];
export let pruneCallCounter = 0;
export const lastSearchResults: Array<{ id: string; label: string | undefined; scope: MemoryScope }> = [];

export function normalizeScope(
  scope: string | undefined,
  fallback: "all" | "global" | "project" = "all",
): "all" | "global" | "project" {
  return (scope ?? fallback) as "all" | "global" | "project";
}

export function boundedContentTokens(content: string | undefined, summary: string | null | undefined): number {
  return estimateTokens(summary ?? (content ?? "").slice(0, TOKEN_CAP_CHARS));
}

/**
 * Cross-scope label resolution. Injected memory blocks and the rating
 * invitation (`learn(mode="rate", label=...)`) don't carry scope, so agents
 * routinely omit it while tool defaults say "project" — a global node
 * (e.g. rule:feature:*) then used to hard-fail with "Memory node not found:
 * project:<label>". Try the preferred scope first (deterministic when a label
 * exists in both scopes), then the other; scope "all" tries project then
 * global. On a total miss, throw with up to 3 trigram-similar labels so a
 * hallucinated or mistyped label is self-correcting instead of a dead end.
 */
export async function resolveNodeByLabel(
  store: MemoryStore,
  label: string,
  preferredScope: string = "project",
): Promise<MemoryNode> {
  const order: MemoryScope[] = preferredScope === "global" ? ["global", "project"] : ["project", "global"];
  let lastError: unknown = null;
  for (const scope of order) {
    try {
      return await store.getNodeByLabel(scope, label);
    } catch (err) {
      lastError = err;
    }
  }
  const allNodes = await store.listNodes("all", undefined, 200).catch(() => [] as MemoryNode[]);
  const needle = label.toLowerCase();
  const similar = allNodes
    .filter((n): n is MemoryNode & { label: string } => Boolean(n.label))
    .map(n => ({ n, sim: trigramJaccard(needle, n.label.toLowerCase()) }))
    .filter(x => x.sim >= 0.25)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3)
    .map(x => `${x.n.label} (${x.n.scope})`);
  const base = lastError instanceof Error ? lastError.message : `Memory node not found: ${label}`;
  throw new Error(similar.length > 0 ? `${base} — similar: ${similar.join(", ")}` : base);
}

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
    return await resolveNodeByLabel(store, args.label, args.scope ?? "project");
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