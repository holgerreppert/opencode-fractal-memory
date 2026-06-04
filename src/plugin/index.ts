import type { Plugin } from "@opencode-ai/plugin";
import { initStorage, loadPluginConfig, seedRuleNodes, backfillData, scheduleBackgroundEmbeddings, setupJournal, startManagementIfEnabled, createAutoRetrieveIfEnabled } from "./init";
import { createHookHandlers } from "./hooks";
import { createToolMap } from "./tools";
import { memLog, perfNow } from "../logging";

export const MemoryPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx;
  const t0 = perfNow();

  memLog("info", "init", "Plugin initialization started", { directory });

  let t = perfNow();
  const store = await initStorage(directory);
  memLog("info", "init", "Storage initialized", { durationMs: perfNow() - t });

  t = perfNow();
  const memConfig = await loadPluginConfig(directory);
  memLog("info", "init", "Config loaded", { durationMs: perfNow() - t });

  t = perfNow();
  await seedRuleNodes(store);
  memLog("info", "init", "Seed nodes completed", { durationMs: perfNow() - t });

  t = perfNow();
  await backfillData(store);
  memLog("info", "init", "Backfill completed", { durationMs: perfNow() - t });

  t = perfNow();
  scheduleBackgroundEmbeddings(store);
  memLog("info", "init", "Background embeddings scheduled", { durationMs: perfNow() - t });

  t = perfNow();
  const journalTools = await setupJournal(directory);
  memLog("info", "init", "Journal setup completed", { durationMs: perfNow() - t });

  t = perfNow();
  startManagementIfEnabled(store, directory);
  memLog("info", "init", "Management server check completed", { durationMs: perfNow() - t });

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

  memLog("info", "init", "Plugin initialization completed", { totalDurationMs: perfNow() - t0 });

  return {
    ...handlers,
    ...(autoRetrieveHook || {}),
    tool: toolMap,
    cleanup: async () => {
      await store.close();
    },
  };
};
