import type { Plugin } from "@opencode-ai/plugin";
import { createApplication, createAutoRetrieve, scheduleBackgroundEmbeddings } from "../infrastructure/composition-root";
import { createHookHandlers } from "./hooks";
import { createToolMap } from "./tools";
import { memLog, perfNow } from "../logging";
import { stopManagementServer, ensureManagementServer } from "../management-server";
import { setupJournal } from "./init";

export const MemoryPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx;
  const t0 = perfNow();

  memLog("info", "init", "Plugin initialization started", { directory, serverUrl: ctx.serverUrl.origin });

  let t = perfNow();
  const { store, memConfig } = await createApplication(directory);
  memLog("info", "init", "Application context created", { durationMs: perfNow() - t });

  const ruleCache: Map<string, { content: string; type: string }> = new Map();
  const ruleCacheDirty = { value: true };
  const sessionInjectionLock: Map<string, boolean> = new Map();
  const latestUserMessage = { value: "" };

  t = perfNow();
  scheduleBackgroundEmbeddings(store);
  memLog("info", "init", "Background embeddings scheduled", { durationMs: perfNow() - t });

  t = perfNow();
  const journalTools = await setupJournal(directory, memConfig);
  memLog("info", "init", "Journal setup completed", { durationMs: perfNow() - t });

  const currentSessionId: { value: string } = { value: "" };
  const autoRetrieveHook = createAutoRetrieve(store, memConfig, client, currentSessionId);

  const handlers = createHookHandlers(
    store, client, memConfig,
    ruleCache, ruleCacheDirty, sessionInjectionLock, latestUserMessage,
    { start: ensureManagementServer, stop: stopManagementServer },
  );
  const toolMap = createToolMap(store, journalTools, client);

  memLog("info", "init", "Plugin initialization completed", { totalDurationMs: perfNow() - t0 });

  const smallModelMap = ((memConfig as any).smallModel ?? {}) as Record<string, string>;

  return {
    ...handlers,
    ...(autoRetrieveHook || {}),
    tool: toolMap,
    "chat.message": async (input: { sessionID: string }) => {
      currentSessionId.value = input.sessionID;
    },
    "experimental.provider.small_model": async (input: { provider: string }, output: { model?: string }) => {
      const configured = smallModelMap[input.provider];
      if (configured) {
        output.model = configured;
      }
    },
    dispose: async () => {
      stopManagementServer();
      await store.close();
    },
  };
};
