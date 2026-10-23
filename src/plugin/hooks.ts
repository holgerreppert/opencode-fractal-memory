import type { MemoryStore } from "../storage/sqlite";
import type { SessionApi } from "./session-api";
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
import { createInjectionDigestHandler } from "./hooks/injection-digest";
import { createGraphContextHandler } from "./hooks/graph-context";
import { createGraphEditCheckHandler } from "./hooks/graph-edit-check";
import { createGraphSearchHintHandler } from "./hooks/graph-search-hint";
import { createToolDedupHandler } from "./hooks/tool-dedup";
import { createErrorPruneHandler } from "./hooks/error-prune";
import { createToolBeforeGuardHandler } from "./hooks/tool-before-guard";
import { createContextCompressTransformHandler } from "./hooks/context-compress-transform";
import type { CompactionEvent, PromptEvent, MessagesEvent, OptionsEvent, PluginEvent, PluginHooks, SystemEvent, ToolAfterEvent, ToolBeforeEvent } from "./hooks/types";
import { runToolResultPipeline, wrapHookHandlerAsTransformer, type ToolResultTransformer } from "./tool-result-pipeline";

const TURN_COUNTERS = new Map<string, number>();

function nextTurnIndex(sessionId: string): number {
  const cur = TURN_COUNTERS.get(sessionId) ?? 0;
  TURN_COUNTERS.set(sessionId, cur + 1);
  return cur;
}

export function createHookHandlers(
  store: MemoryStore,
  session: SessionApi,
  memConfig: MemConfig,
  ruleCache: Map<string, { content: string; type: string }>,
  ruleCacheDirty: { value: boolean },
  sessionInjectionLock: Map<string, boolean>,
  latestUserMessage: { value: string },
  managementServer: { start: () => void; stop: () => void },
  currentSessionId: { value: string },
  directory: string,
) {
  const toolBeforeGuard = createToolBeforeGuardHandler();

  const dedupHandler = createToolDedupHandler(memConfig);
  const errorPruneHandler = createErrorPruneHandler(memConfig);
  const recordingHandler = createRecordingHandler(store, memConfig);
  const workingCacheHandler = createWorkingCacheHandler(store);
  const compressionHandler = createCompressionHandler(store, memConfig);
  const nonBashCompressionHandler = createNonBashCompressionHandler();
  const reReadHandler = createReReadEliminationHandler(memConfig);
  const adaptivePressureHandler = createAdaptivePressureHandler(memConfig);
  const seedRulesHandler = createSeedRulesHandler(store, memConfig, ruleCache, ruleCacheDirty, sessionInjectionLock);
  const compactionHandler = createCompactionHandler(store, memConfig, session);
  const eventHandler = createEventHandler(store, memConfig, session, managementServer, directory);
  const outputTokenHandler = createOutputTokenControlHandler(memConfig);
  const chatParamsHandler = createChatParamsHandler(memConfig);
  const messagesTransformHandler = createMessagesTransformHandler(store, memConfig, currentSessionId);
  const contextCompressHandler = createContextCompressTransformHandler(store, memConfig, currentSessionId);
  const graphRefreshHandler = createGraphRefreshHandler(memConfig, directory);
  const graphContextHandler = createGraphContextHandler(memConfig);
  const graphEditCheckHandler = createGraphEditCheckHandler(memConfig, directory);
  const graphSearchHintHandler = createGraphSearchHintHandler(memConfig, directory);
  const injectionDigestHandler = createInjectionDigestHandler(store, memConfig, currentSessionId);

  const handlers: PluginHooks[] = [
    dedupHandler,
    errorPruneHandler,
    toolBeforeGuard,
    recordingHandler,
    workingCacheHandler,
    compressionHandler,
    nonBashCompressionHandler,
    reReadHandler,
    adaptivePressureHandler,
    seedRulesHandler,
    compactionHandler,
    eventHandler,
    outputTokenHandler,
    chatParamsHandler,
    messagesTransformHandler,
    contextCompressHandler,
    graphRefreshHandler,
    graphContextHandler,
    graphEditCheckHandler,
    graphSearchHintHandler,
    injectionDigestHandler,
  ];

  // Explicit tool-result pipeline — ordered by priority, each step logs provenance + metrics
  const toolAfterPipeline: ToolResultTransformer[] = [
    wrapHookHandlerAsTransformer("tool-before-guard", 5, toolBeforeGuard),
    wrapHookHandlerAsTransformer("tool-dedup", 10, dedupHandler),
    wrapHookHandlerAsTransformer("error-prune", 20, errorPruneHandler),
    wrapHookHandlerAsTransformer("working-cache", 30, workingCacheHandler),
    wrapHookHandlerAsTransformer("recording", 35, recordingHandler),
    wrapHookHandlerAsTransformer("re-read-elimination", 40, reReadHandler),
    wrapHookHandlerAsTransformer("compression", 50, compressionHandler),
    wrapHookHandlerAsTransformer("non-bash-compression", 51, nonBashCompressionHandler),
    wrapHookHandlerAsTransformer("adaptive-pressure", 60, adaptivePressureHandler),
    wrapHookHandlerAsTransformer("graph-context", 70, graphContextHandler),
    wrapHookHandlerAsTransformer("graph-search-hint", 71, graphSearchHintHandler),
    wrapHookHandlerAsTransformer("graph-edit-check", 72, graphEditCheckHandler),
    wrapHookHandlerAsTransformer("graph-refresh", 73, graphRefreshHandler),
    wrapHookHandlerAsTransformer("injection-digest", 80, injectionDigestHandler),
  ];

  async function callHooks(method: keyof PluginHooks, event: never): Promise<void> {
    for (const handler of handlers) {
      const fn = handler[method];
      if (fn) {
        try {
          await (fn as (e: never) => Promise<void>)(event);
        } catch (err) {
          memLog("error", "hooks", `Handler ${method} failed`, { error: String(err) });
        }
      }
    }
  }

  return {
    "system": (event: SystemEvent) => callHooks("system", event as never),
    "tool.execute.before": (event: ToolBeforeEvent) => callHooks("tool.execute.before", event as never),
    "tool.execute.after": async (event: ToolAfterEvent) => {
      const toolName = event.tool;
      const sid = event.sessionID;
      if (sid && toolName) {
        currentSessionId.value = sid;
        try {
          const argsPreview = JSON.stringify(event.args || {}).slice(0, 500);
          const outputPreview = (event.output ?? "").slice(0, 500);
          const success = event.output === undefined ? null : true;
          await store.recordConversationTurn({
            sessionId: sid,
            timestamp: Date.now(),
            turnIndex: nextTurnIndex(sid),
            role: "tool",
            content: event.title || `tool:${toolName}`,
            toolName,
            toolArgs: argsPreview,
            toolResult: outputPreview,
            tokenCount: Math.round(outputPreview.length / 4),
          });
          try {
            await store.recordAgentToolCall(sid, toolName, event.args ?? null, event.output ?? null, success, null);
          } catch (recordErr) {
            memLog("warn", "live-capture", "Failed to record agent tool call", { tool: toolName, error: String(recordErr) });
          }
          memLog("debug", "live-capture", "Captured tool call", { sessionId: sid, tool: toolName });
        } catch (e) {
          memLog("error", "live-capture", "Failed to capture tool call", { error: String(e) });
        }
      }
      // Explicit pipeline — ordered, typed, with provenance + per-transform metrics
      const raw: import("./tool-result-pipeline").ToolResult = {
        tool: toolName || "unknown",
        ...(sid !== undefined ? { sessionID: sid } : {}),
        ...(event.args !== undefined ? { args: event.args } : {}),
        ...(event.output !== undefined ? { output: event.output } : {}),
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      };
      const result = await runToolResultPipeline(raw, toolAfterPipeline);
      // copy pipeline result back onto the event
      const cur = result.current;
      event.output = cur.output ?? "";
      if (cur.title !== undefined) event.title = cur.title;
      if (cur.metadata !== undefined) event.metadata = cur.metadata;
      memLog("info", "hooks", "tool.execute.after pipeline finished", {
        tool: raw.tool,
        provenance: result.provenance.map((r) => `${r.name}:${r.applied ? "ok" : "skip"}:${r.durationMs}ms`).join(","),
      });
    },
    "compaction": (event: CompactionEvent) => callHooks("compaction", event as never),
    "options": (event: OptionsEvent) => callHooks("options", event as never),
    "messages": (event: MessagesEvent) => callHooks("messages", event as never),
    "message": (event: PromptEvent) => callHooks("message", event as never),
    "event": (event: PluginEvent) => callHooks("event", event as never),
  };
}
