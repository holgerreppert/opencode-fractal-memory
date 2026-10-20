import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Provider, Model } from "@opencode-ai/sdk/v2";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createApplication, createAutoRetrieve, scheduleBackgroundEmbeddings } from "../infrastructure/composition-root";
import { selfRegisterTui } from "../infrastructure/tui-self-register";
import { createHookHandlers } from "./hooks";
import { createToolMap } from "./tools";
import { memLog, perfNow } from "../logging";
import { resetInjectionLedger } from "../application/injection-visibility";
import { stopManagementServer, ensureManagementServer } from "../management-server";
import { setupJournal } from "./init";
import { createRegisterAgentsHandler } from "./hooks/register-agents";
import { createJournalStore } from "../application/journal";
import { ToastService } from "../infrastructure/toast-service";
import { incrementTurn } from "../application/re-read-elimination";
import { setupV2, createV2Client } from "./v2-adapter";
import type { V2Context } from "./v2-adapter";

// Read the plugin version from the installed package.json next to dist/ (covers
// both the repo layout and the plugin-cache copy OpenCode actually loads).
// At runtime import.meta.dir = <pkg>/dist/plugin → two levels up is <pkg>/.
function loadPluginVersion(): string {
  try {
    const pkgPath = path.join(import.meta.dir, "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Shared core: everything both the V1 and V2 entrypoints need.
 *
 * Built once per plugin instance so the V1 `server()` path and the V2
 * `setup()` path register the exact same handlers and tools.
 */
async function createCore(directory: string, client: unknown, serverUrl?: string) {
  const t0 = perfNow();

  memLog("info", "init", "Plugin initialization started", { directory, serverUrl });

  memLog("info", "TestLogging", "PLUGIN_LOADED_FROM", {
    resolvedDir: import.meta.dir,
    entryFile: import.meta.path,
    version: loadPluginVersion(),
  });

  // Self-heal TUI registration: OpenCode installs packages with --ignore-scripts,
  // so postinstall never runs for registry installs. Ensure the npm spec is in
  // ~/.config/opencode/tui.json + resolvable via node_modules link. Non-fatal.
  try {
    const pkgRoot = path.resolve(import.meta.dir, "..", "..");
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf-8")) as { name?: string };
    if (pkg.name) selfRegisterTui(pkgRoot, pkg.name);
  } catch { /* non-fatal */ }

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
  // Shared ToastService — callable from the tool factory, hooks, and any other
  // component that needs to surface a UI notification.
  const toastService = new ToastService(client, {
    enabled: memConfig.contextCompression?.enabled ?? true,
    mode: memConfig.contextCompression?.notificationMode ?? "chat",
  });
  // Shared per-session compress state is module-level in
  // application/context-compression/state.ts — both the tool factory and the
  // transform handler import it directly (no threading needed).

  const handlers = createHookHandlers(
    store, client, memConfig,
    ruleCache, ruleCacheDirty, sessionInjectionLock, latestUserMessage,
    { start: ensureManagementServer, stop: stopManagementServer },
    currentSessionId,
  );
  const toolMap = createToolMap(store, journalTools, client, journalStore, journalCtx, memConfig, toastService);

  memLog("info", "init", "Plugin initialization completed", { totalDurationMs: perfNow() - t0 });

  const registerAgentsHandler = createRegisterAgentsHandler();
  const smallModelMap = (memConfig.smallModel ?? {}) as Record<string, string>;

  const composedChatMessage = async (input: { sessionID: string }, output: unknown) => {
    currentSessionId.value = input.sessionID;
    incrementTurn();
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

    if (sid && messages && messages.length > 0) {
      const sysText = messages
        .filter((m) => m.info?.role === "system")
        .map((m) => `${m.info?.content ?? ""} ${(m.parts || []).map((p: any) => p.text || "").join(" ")}`)
        .join("\n");
      memLog("debug", "tool-map", "SYSTEM-PROMPT-TOOL-SCAN", {
        sysLen: sysText.length,
        roles: [...new Set(messages.map((m) => m.info?.role ?? "?"))].join(","),
        sysHasArchivecontext: sysText.includes("archivecontext"),
        sysHasCompress: sysText.includes("compress"),
        sysHasMemory: sysText.includes("memory"),
        sysHasSkeletonize: sysText.includes("skeletonize"),
        sysHasGraph: sysText.includes("graph"),
      });
    }

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

  const dispose = async () => {
    stopManagementServer();
    await store.close();
  };

  return {
    handlers,
    toolMap,
    registerAgentsHandler,
    smallModelMap,
    composedChatMessage,
    composedMessagesTransform,
    dispose,
  };
}

/**
 * V1 entrypoint (OpenCode 1.18.x).
 *
 * Returns the string-keyed hook map, the tool map, the config hook, and the
 * dispose hook — the shape V1 expects from a plugin function.
 */
export const MemoryPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory, client } = ctx;

  const core = await createCore(directory, client, ctx.serverUrl?.origin);

  return {
    ...core.handlers,
    "chat.message": core.composedChatMessage,
    "experimental.chat.messages.transform": core.composedMessagesTransform,
    config: core.registerAgentsHandler,
    tool: core.toolMap,
    "experimental.provider.small_model": async (input: { provider: Provider }, output: { model?: Model }) => {
      const configured = core.smallModelMap[input.provider.id];
      if (configured) {
        const model = input.provider.models[configured];
        if (model) {
          output.model = model;
        }
      }
    },
    dispose: core.dispose,
  };
};

/**
 * V2 entrypoint (OpenCode 2.x).
 *
 * V2 plugins register hooks on the domain that owns the operation and get a
 * single mutable event instead of separate input/output objects, so the
 * adapter bridges the V1 handlers onto the V2 domains.
 */
async function setupV2Entry(ctx: V2Context): Promise<() => Promise<void>> {
  const directory = ctx.location.directory;
  // The shared core calls the SDK client with the V1 nested request shape;
  // bridge it onto the V2 session domain.
  const client = createV2Client(ctx as unknown as Parameters<typeof createV2Client>[0]);
  const core = await createCore(directory, client);
  return setupV2(ctx, {
    handlers: core.handlers as Record<string, unknown>,
    toolMap: core.toolMap,
    dispose: core.dispose,
  });
}

/**
 * Dual-shape entrypoint.
 *
 * OpenCode 1.18.29+ calls `server()`; OpenCode 2.x calls `setup()`. The two
 * APIs are separate — the spread does not translate hooks automatically, so
 * each side registers the same handlers through its own adapter.
 */
export default {
  id: "opencode-fractal-memory",
  setup: setupV2Entry,
  server: MemoryPlugin,
};
