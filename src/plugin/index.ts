import type { Plugin } from "@opencode-ai/plugin";
import { createApplication, createAutoRetrieve, scheduleBackgroundEmbeddings } from "../infrastructure/composition-root";
import { createHookHandlers } from "./hooks";
import { createToolMap } from "./tools";
import { memLog, perfNow } from "../logging";
import { resetInjectionLedger } from "../application/injection-visibility";
import { stopManagementServer, ensureManagementServer } from "../management-server";
import { setupJournal } from "./init";
import { createRegisterAgentsHandler } from "./hooks/register-agents";
import { createJournalStore } from "../application/journal";

export const MemoryPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx;
  const t0 = perfNow();

  memLog("info", "init", "Plugin initialization started", { directory, serverUrl: ctx.serverUrl.origin });

  let t = perfNow();
  let store!: import("../storage/sqlite").MemoryStore;
  let memConfig!: import("../infrastructure/config/config").MemConfig;
  try {
    const app = await createApplication(directory);
    store = app.store;
    memConfig = app.memConfig;
    memLog("info", "init", "Application context created", { durationMs: perfNow() - t, mgmtStarted: app.managementStarted });
  } catch (err) {
    memLog("error", "init", "createApplication failed", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }

  const ruleCache: Map<string, { content: string; type: string }> = new Map();
  const ruleCacheDirty = { value: true };
  const sessionInjectionLock: Map<string, boolean> = new Map();
  const latestUserMessage = { value: "" };

  t = perfNow();
  scheduleBackgroundEmbeddings(store);
  memLog("info", "init", "Background embeddings scheduled", { durationMs: perfNow() - t });

  t = perfNow();
  const journalTools = await setupJournal(directory, memConfig);
  const journalStore = memConfig.journal?.enabled ? createJournalStore() : null;
  const journalCtx = { directory, model: "", provider: "" };
  memLog("info", "init", "Journal setup completed", { durationMs: perfNow() - t });

  const currentSessionId: { value: string } = { value: "" };
  const autoRetrieveHook = createAutoRetrieve(store, memConfig, client, currentSessionId);

  const handlers = createHookHandlers(
    store, client, memConfig,
    ruleCache, ruleCacheDirty, sessionInjectionLock, latestUserMessage,
    { start: ensureManagementServer, stop: stopManagementServer },
    currentSessionId,
  );
  const toolMap = createToolMap(store, journalTools, client, journalStore, journalCtx, memConfig);

  memLog("info", "init", "Plugin initialization completed", { totalDurationMs: perfNow() - t0 });

  const registerAgentsHandler = createRegisterAgentsHandler();
  const smallModelMap = (memConfig.smallModel ?? {}) as Record<string, string>;

  const composedChatMessage = async (input: { sessionID: string }, output: unknown) => {
    currentSessionId.value = input.sessionID;
    memLog("info", "live-capture", "composedChatMessage called", { sessionID: input.sessionID, hasHandler: !!handlers["chat.message"] });
    if (handlers["chat.message"]) {
      await handlers["chat.message"](input, output);
    }
  };

  const capturedMessageCounts = new Map<string, number>();
  const turnIndexCounters = new Map<string, number>();

  function nextTurnIndex(sessionId: string): number {
    const cur = turnIndexCounters.get(sessionId) ?? 0;
    turnIndexCounters.set(sessionId, cur + 1);
    return cur;
  }

  const composedMessagesTransform = async (input: unknown, output: unknown) => {
    const out = output as { messages?: Array<{ info: { role?: string; content?: string }; parts?: Array<{ type?: string; text?: string }> }> };
    const messages = out?.messages;
    const sid = currentSessionId.value;

    resetInjectionLedger();

    if (sid && messages && messages.length > 0) {
      const lastCount = capturedMessageCounts.get(sid) ?? 0;
      if (messages.length > lastCount) {
        const newMessages = messages.slice(lastCount);
        for (const msg of newMessages) {
          const role = msg.info?.role;
          if (role !== "user" && role !== "assistant") continue;
          const content = msg.info?.content || "";
          const partText = (msg.parts || []).map((p: any) => p.text || "").join("");
          const fullContent = content || partText;
          if (!fullContent) continue;
          try {
            await store.recordConversationTurn({
              sessionId: sid,
              timestamp: Date.now(),
              turnIndex: nextTurnIndex(sid),
              role,
              content: fullContent,
              tokenCount: Math.round(fullContent.length / 4),
            });
            memLog("debug", "live-capture", `Captured ${role} from messages.transform`, { sessionId: sid, textLen: fullContent.length });
          } catch (e) {
            memLog("error", "live-capture", `Failed to capture ${role}`, { error: String(e) });
          }
        }
        capturedMessageCounts.set(sid, messages.length);
      }
    }

    if (autoRetrieveHook) {
      const arHandler = autoRetrieveHook["experimental.chat.messages.transform"];
      if (arHandler) {
        await arHandler(input, output as any);
      }
    }
    await handlers["experimental.chat.messages.transform"]?.(input, output);
  };

  return {
    ...handlers,
    "chat.message": composedChatMessage,
    "experimental.chat.messages.transform": composedMessagesTransform,
    config: registerAgentsHandler,
    tool: toolMap,
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
