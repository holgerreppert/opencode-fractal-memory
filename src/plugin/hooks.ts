import type { MemoryStore } from "../storage/sqlite";
import type { MemConfig } from "../infrastructure/config/config";
import { memLog } from "../logging";
import { createRecordingHandler } from "./hooks/recording";
import { createWorkingCacheHandler } from "./hooks/working-cache";
import { createCompressionHandler } from "./hooks/compression";
import { createNonBashCompressionHandler } from "./hooks/tool-compression";
import { createReReadEliminationHandler } from "./hooks/re-read-elimination";
import { createAdaptivePressureHandler } from "./hooks/adaptive-pressure";
import { createSeedRulesHandler } from "./hooks/seed-rules";
import { createCompactionHandler } from "./hooks/compaction";
import { createEventHandler } from "./hooks/events";
import { createOutputTokenControlHandler } from "./hooks/output-token-control";
import { createChatParamsHandler } from "./hooks/chat-params";
import { createMessagesTransformHandler } from "./hooks/messages-transform";
import { createGraphRefreshHandler } from "./hooks/graph-refresh";
import { createGraphContextHandler } from "./hooks/graph-context";
import { createGraphEditCheckHandler } from "./hooks/graph-edit-check";
import { createGraphSearchHintHandler } from "./hooks/graph-search-hint";
import { createToolDedupHandler } from "./hooks/tool-dedup";
import { createErrorPruneHandler } from "./hooks/error-prune";
import { createToolDefinitionHandler } from "./hooks/tool-definition";
import { createToolBeforeGuardHandler } from "./hooks/tool-before-guard";
import type { HookHandler } from "./hooks/types";

const TURN_COUNTERS = new Map<string, number>();

function nextTurnIndex(sessionId: string): number {
  const cur = TURN_COUNTERS.get(sessionId) ?? 0;
  TURN_COUNTERS.set(sessionId, cur + 1);
  return cur;
}

export function createHookHandlers(
  store: MemoryStore,
  client: unknown,
  memConfig: MemConfig,
  ruleCache: Map<string, { content: string; type: string }>,
  ruleCacheDirty: { value: boolean },
  sessionInjectionLock: Map<string, boolean>,
  latestUserMessage: { value: string },
  managementServer: { start: () => void; stop: () => void },
  currentSessionId: { value: string },
) {
  const toolBeforeGuard = createToolBeforeGuardHandler();

  const handlers: HookHandler[] = [
    createToolDedupHandler(memConfig),
    createErrorPruneHandler(memConfig),
    toolBeforeGuard,
    createToolDefinitionHandler(),
    createRecordingHandler(store, memConfig),
    createWorkingCacheHandler(store),
    createCompressionHandler(store, memConfig),
    createNonBashCompressionHandler(),
    createReReadEliminationHandler(memConfig),
    createAdaptivePressureHandler(memConfig),
    createSeedRulesHandler(store, memConfig, ruleCache, ruleCacheDirty, sessionInjectionLock),
    createCompactionHandler(store, memConfig, client),
    createEventHandler(store, memConfig, client, managementServer),
    createOutputTokenControlHandler(memConfig),
    createChatParamsHandler(memConfig),
    createMessagesTransformHandler(store, memConfig, currentSessionId),
    createGraphRefreshHandler(memConfig),
    createGraphContextHandler(memConfig),
    createGraphEditCheckHandler(memConfig),
    createGraphSearchHintHandler(memConfig),
  ];

  async function callHooks(method: keyof HookHandler, ...args: Parameters<NonNullable<HookHandler[keyof HookHandler]>>): Promise<void> {
    for (const handler of handlers) {
      const fn = handler[method];
      if (fn) {
        try {
          await (fn as (...a: Parameters<NonNullable<HookHandler[keyof HookHandler]>>) => Promise<void>)(...args);
        } catch (err) {
          memLog("error", "hooks", `Handler ${method} failed`, { error: String(err) });
        }
      }
    }
  }

  return {
    "experimental.chat.system.transform": (input: unknown, output: unknown) =>
      callHooks("system.transform", input, output),
    "tool.execute.before": (input: unknown, output: unknown) =>
      callHooks("tool.before", input, output),
    "tool.execute.after": async (input: unknown, output: unknown) => {
      const inp = input as { tool?: string; sessionID?: string; callID?: string; args?: Record<string, unknown> };
      const out = output as { title?: string; output?: string; metadata?: Record<string, unknown> };
      const toolName = inp?.tool;
      const sid = inp?.sessionID;
      if (sid && toolName) {
        currentSessionId.value = sid;
        try {
          const argsPreview = JSON.stringify(inp?.args || {}).slice(0, 500);
          const outputPreview = (out?.output ?? "").slice(0, 500);
          await store.recordConversationTurn({
            sessionId: sid,
            timestamp: Date.now(),
            turnIndex: nextTurnIndex(sid),
            role: "tool",
            content: out?.title || `tool:${toolName}`,
            toolName,
            toolArgs: argsPreview,
            toolResult: outputPreview,
            tokenCount: Math.round(outputPreview.length / 4),
          });
          memLog("debug", "live-capture", "Captured tool call", { sessionId: sid, tool: toolName });
        } catch (e) {
          memLog("error", "live-capture", "Failed to capture tool call", { error: String(e) });
        }
      }
      await callHooks("tool.after", input, output);
    },
    "tool.definition": (input: unknown, output: unknown) =>
      callHooks("tool.definition", input, output),
    "experimental.session.compacting": (input: unknown, output: unknown) =>
      callHooks("compacting", input, output),
    "experimental.compaction.autocontinue": async (input: unknown, output: { enabled: boolean }) => {
      output.enabled = true;
      await callHooks("compaction.autocontinue", input, output);
    },
    "chat.params": (input: unknown, output: unknown) =>
      callHooks("chat.params", input, output),
    "experimental.chat.messages.transform": (input: unknown, output: unknown) =>
      callHooks("chat.messages.transform", input, output),
    "chat.message": async (input: unknown, output: unknown) => {
      await callHooks("chat.message", input, output);
    },
    event: (input: unknown) => (callHooks as (...args: unknown[]) => Promise<void>)("event", input),
  };
}
