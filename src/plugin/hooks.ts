import type { MemoryStore, MemoryScope } from "../storage/sqlite";
import type { MemConfig } from "../config";
import { memLog } from "../logging";
import { createRecordingHandler } from "./hooks/recording";
import { createWorkingCacheHandler } from "./hooks/working-cache";
import { createCompressionHandler } from "./hooks/compression";
import { createSkeletonizationHandler } from "./hooks/skeletonization";
import { createFileSummaryHandler } from "./hooks/file-summary";
import { createReReadEliminationHandler } from "./hooks/re-read-elimination";
import { createSeedRulesHandler } from "./hooks/seed-rules";
import { createCompactionHandler } from "./hooks/compaction";
import { createEventHandler } from "./hooks/events";
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
    createSkeletonizationHandler(memConfig),
    createFileSummaryHandler(store, memConfig),
    createReReadEliminationHandler(memConfig),
    createSeedRulesHandler(store, memConfig, ruleCache, ruleCacheDirty, sessionInjectionLock),
    createCompactionHandler(store, memConfig, client),
    createEventHandler(store, memConfig, client, managementServer),
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
    "experimental.chat.system.transform": (input: any, output: any) =>
      callHooks("system.transform", input, output),
    "tool.execute.before": (input: any, output: any) =>
      callHooks("tool.before", input, output),
    "tool.execute.after": (input: any, output: any) =>
      callHooks("tool.after", input, output),
    "experimental.session.compacting": (input: any, output: any) =>
      callHooks("compacting", input, output),
    "experimental.compaction.autocontinue": async (_input: unknown, output: { enabled: boolean }) => {
      output.enabled = true;
    },
    event: (input: any) => callHooks("event", input),
  };
}
