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
import { createInjectionDigestHandler } from "./hooks/injection-digest";
import { createGraphContextHandler } from "./hooks/graph-context";
import { createGraphEditCheckHandler } from "./hooks/graph-edit-check";
import { createGraphSearchHintHandler } from "./hooks/graph-search-hint";
import { createToolDedupHandler } from "./hooks/tool-dedup";
import { createErrorPruneHandler } from "./hooks/error-prune";
import { createToolDefinitionHandler } from "./hooks/tool-definition";
import { createToolBeforeGuardHandler } from "./hooks/tool-before-guard";
import { createContextCompressTransformHandler } from "./hooks/context-compress-transform";
import { createTextCompleteHandler } from "./hooks/text-complete";
import type { HookHandler } from "./hooks/types";
import { runToolResultPipeline, wrapHookHandlerAsTransformer, type ToolResultTransformer } from "./tool-result-pipeline";

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

  const dedupHandler = createToolDedupHandler(memConfig);
  const errorPruneHandler = createErrorPruneHandler(memConfig);
  const recordingHandler = createRecordingHandler(store, memConfig);
  const workingCacheHandler = createWorkingCacheHandler(store);
  const compressionHandler = createCompressionHandler(store, memConfig);
  const nonBashCompressionHandler = createNonBashCompressionHandler();
  const reReadHandler = createReReadEliminationHandler(memConfig);
  const adaptivePressureHandler = createAdaptivePressureHandler(memConfig);
  const seedRulesHandler = createSeedRulesHandler(store, memConfig, ruleCache, ruleCacheDirty, sessionInjectionLock);
  const compactionHandler = createCompactionHandler(store, memConfig, client);
  const eventHandler = createEventHandler(store, memConfig, client, managementServer);
  const outputTokenHandler = createOutputTokenControlHandler(memConfig);
  const chatParamsHandler = createChatParamsHandler(memConfig);
  const messagesTransformHandler = createMessagesTransformHandler(store, memConfig, currentSessionId);
  const contextCompressHandler = createContextCompressTransformHandler(store, memConfig, currentSessionId);
  const graphRefreshHandler = createGraphRefreshHandler(memConfig);
  const graphContextHandler = createGraphContextHandler(memConfig);
  const graphEditCheckHandler = createGraphEditCheckHandler(memConfig);
  const graphSearchHintHandler = createGraphSearchHintHandler(memConfig);
  const injectionDigestHandler = createInjectionDigestHandler(store, memConfig, currentSessionId);
  const toolDefinitionHandler = createToolDefinitionHandler();
  const textCompleteHandler = createTextCompleteHandler();

  const handlers: HookHandler[] = [
    dedupHandler,
    errorPruneHandler,
    toolBeforeGuard,
    toolDefinitionHandler,
    textCompleteHandler,
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
          const success = out?.output === undefined ? null : true;
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
          try {
            await store.recordAgentToolCall(sid, toolName, inp?.args ?? null, out?.output ?? null, success, null);
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
        tool: (inp?.tool as string) ?? "unknown",
        ...(inp?.sessionID !== undefined ? { sessionID: inp.sessionID } : {}),
        ...(inp?.args !== undefined ? { args: inp.args } : {}),
        ...((out as { output?: string })?.output !== undefined ? { output: (out as { output: string }).output } : {}),
        ...((out as { title?: string })?.title !== undefined ? { title: (out as { title: string }).title } : {}),
        ...((out as { metadata?: Record<string, unknown> })?.metadata !== undefined ? { metadata: (out as { metadata: Record<string, unknown> }).metadata } : {}),
      }
      const result = await runToolResultPipeline(raw, toolAfterPipeline)
      // copy pipeline result back to opencode's output object
      const cur = result.current
      if (out && typeof out === "object") {
        const o = out as Record<string, unknown>
        o["output"] = cur.output
        if (cur.title !== undefined) o["title"] = cur.title
        if (cur.metadata !== undefined) o["metadata"] = cur.metadata
        // attach provenance for management live feed / debugging
        o["__pipelineProvenance"] = result.provenance
      }
      memLog("info", "hooks", "tool.after pipeline finished", {
        tool: raw.tool,
        provenance: result.provenance.map((r) => `${r.name}:${r.applied ? "ok" : "skip"}:${r.durationMs}ms`).join(","),
      })
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
    "experimental.text.complete": (input: unknown, output: unknown) =>
      callHooks("text.complete", input, output),
    event: (input: unknown) => (callHooks as (...args: unknown[]) => Promise<void>)("event", input),
  };
}
