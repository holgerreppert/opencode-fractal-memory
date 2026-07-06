import type { MemoryStore } from "../storage/sqlite";
import type { MemConfig } from "../infrastructure/config/config";
import { memLog } from "../logging";
import { createRecordingHandler } from "./hooks/recording";
import { createWorkingCacheHandler } from "./hooks/working-cache";
import { createCompressionHandler } from "./hooks/compression";
import { createNonBashCompressionHandler } from "./hooks/tool-compression";
import { createSkeletonizationHandler } from "./hooks/skeletonization";
import { createFileSummaryHandler } from "./hooks/file-summary";
import { createReReadEliminationHandler } from "./hooks/re-read-elimination";
import { createAdaptivePressureHandler } from "./hooks/adaptive-pressure";
import { createSeedRulesHandler } from "./hooks/seed-rules";
import { createCompactionHandler } from "./hooks/compaction";
import { createEventHandler } from "./hooks/events";
import { createOutputTokenControlHandler } from "./hooks/output-token-control";
import { createChatParamsHandler } from "./hooks/chat-params";
import { createMessagesTransformHandler } from "./hooks/messages-transform";
import { createGraphToolsHandler } from "./hooks/graph-tools";
import type { HookHandler } from "./hooks/types";

export function createHookHandlers(
  store: MemoryStore,
  client: unknown,
  memConfig: MemConfig,
  ruleCache: Map<string, { content: string; type: string }>,
  ruleCacheDirty: { value: boolean },
  sessionInjectionLock: Map<string, boolean>,
  latestUserMessage: { value: string },
  managementServer: { start: () => void; stop: () => void },
) {
  const handlers: HookHandler[] = [
    createRecordingHandler(store, memConfig),
    createWorkingCacheHandler(store),
    createCompressionHandler(store, memConfig),
    createNonBashCompressionHandler(),
    createSkeletonizationHandler(memConfig),
    createFileSummaryHandler(store, memConfig),
    createReReadEliminationHandler(memConfig),
    createAdaptivePressureHandler(memConfig),
    createSeedRulesHandler(store, memConfig, ruleCache, ruleCacheDirty, sessionInjectionLock),
    createCompactionHandler(store, memConfig, client),
    createEventHandler(store, memConfig, client, managementServer),
    createOutputTokenControlHandler(memConfig),
    createChatParamsHandler(memConfig),
    createMessagesTransformHandler(store, memConfig),
    createGraphToolsHandler(memConfig),
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
    "tool.execute.after": (input: unknown, output: unknown) =>
      callHooks("tool.after", input, output),
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
    event: (input: unknown) => (callHooks as (...args: unknown[]) => Promise<void>)("event", input),
  };
}
