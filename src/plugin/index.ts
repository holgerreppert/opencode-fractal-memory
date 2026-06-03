import type { Plugin } from "@opencode-ai/plugin";
import { initStorage, loadPluginConfig, seedRuleNodes, backfillData, scheduleBackgroundEmbeddings, setupJournal, startManagementIfEnabled, createAutoRetrieveIfEnabled } from "./init";
import { createHookHandlers } from "./hooks";
import { createToolMap } from "./tools";

export const MemoryPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx;

  const store = await initStorage(directory);

  const memConfig = await loadPluginConfig(directory);

  await seedRuleNodes(store);
  await backfillData(store);
  scheduleBackgroundEmbeddings(store);

  const journalTools = await setupJournal(directory);
  startManagementIfEnabled(store, directory);

  const ruleCache: Map<string, { content: string; type: string }> = new Map();
  const ruleCacheDirty = { value: true };
  const sessionInjectionLock: Map<string, boolean> = new Map();
  const latestUserMessage = { value: "" };

  const autoRetrieveHook = createAutoRetrieveIfEnabled(store, memConfig);

  const handlers = createHookHandlers(
    store, client, memConfig,
    ruleCache, ruleCacheDirty, sessionInjectionLock, latestUserMessage,
  );
  const toolMap = createToolMap(store, journalTools, client);

  return {
    ...handlers,
    ...(autoRetrieveHook || {}),
    tool: toolMap,
    cleanup: async () => {
      await store.close();
    },
  };
};
