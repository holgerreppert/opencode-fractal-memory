import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createApplication,
  createAutoRetrieve,
  scheduleBackgroundEmbeddings,
  startApplicationBackground,
} from "../infrastructure/composition-root";
import { createHookHandlers } from "./hooks";
import type { MessagesEvent, PluginHooks, PromptEvent } from "./hooks/types";
import { createToolMap } from "./tools";
import { memLog, perfNow } from "../logging";
import { resetInjectionLedger } from "../application/injection-visibility";
import { stopManagementServer, ensureManagementServer } from "../management-server";
import { setupJournal } from "./init";
import { createJournalStore } from "../application/journal";
import { ToastService } from "../infrastructure/toast-service";
import { incrementTurn } from "../application/re-read-elimination";
import { registerPlugin, resolveProjectDirectory } from "./registration";
import { createSessionApi, type SessionApi } from "./session-api";
import type { PluginContext } from "./registration";

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

interface Core {
  handlers: PluginHooks;
  toolMap: Record<string, import("../tools/define-tool").ToolDefinition>;
  composedMessage: (event: PromptEvent) => Promise<void>;
  composedMessagesTransform: (event: MessagesEvent) => Promise<void>;
  dispose: () => Promise<void>;
}

/**
 * Shared, per-location core.
 *
 * A globally registered plugin serves EVERY project, so one process can host
 * several locations. Cores are memoized by resolved directory: each location
 * gets its own store/config/handlers, and closing one never touches another's
 * memory scope. Reference counting keeps a shared location alive while more
 * than one plugin setup still holds it.
 */
const cores = new Map<string, { core: Promise<Core>; refs: number }>();

function locationKey(directory: string): string {
  return path.resolve(directory);
}

function getCore(directory: string, session: SessionApi): Promise<Core> {
  const key = locationKey(directory);
  const existing = cores.get(key);
  if (existing) {
    existing.refs++;
    return existing.core;
  }
  const entry = { core: createCore(directory, session), refs: 1 };
  entry.core.catch(() => {
    if (cores.get(key) === entry) cores.delete(key);
  });
  cores.set(key, entry);
  return entry.core;
}

async function releaseCore(directory: string): Promise<void> {
  const key = locationKey(directory);
  const entry = cores.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  cores.delete(key);
  try {
    const core = await entry.core;
    await core.dispose();
  } catch {
    // init never completed — nothing to dispose
  }
  if (cores.size === 0) stopManagementServer();
}

async function createCore(directory: string, session: SessionApi): Promise<Core> {
  const t0 = perfNow();

  memLog("info", "init", "Plugin initialization started", { directory });

  memLog("info", "TestLogging", "PLUGIN_LOADED_FROM", {
    resolvedDir: import.meta.dir,
    entryFile: import.meta.path,
    version: loadPluginVersion(),
  });

  let t = perfNow();
  let store!: import("../storage/sqlite").MemoryStore;
  let memConfig!: import("../infrastructure/config/config").MemConfig;
  let app!: import("../infrastructure/composition-root").ApplicationContext;
  try {
    // Heavy, optional subsystems are deferred: setup() must return before
    // OpenCode's background service health check times out.
    app = await createApplication(directory, undefined, { deferBackground: true });
    store = app.store;
    memConfig = app.memConfig;
    memLog("info", "init", "Application context created", { durationMs: perfNow() - t });
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
  startApplicationBackground(app, directory);
  memLog("info", "init", "Background initialization scheduled", { durationMs: perfNow() - t });

  t = perfNow();
  const journalTools = await setupJournal(directory, memConfig);
  const journalStore = memConfig.journal?.enabled ? createJournalStore() : null;
  const journalCtx = { directory, model: "", provider: "" };
  memLog("info", "init", "Journal setup completed", { durationMs: perfNow() - t });

  const currentSessionId: { value: string } = { value: "" };
  const autoRetrieveHook = createAutoRetrieve(store, memConfig, session, currentSessionId);
  // Shared ToastService — callable from the tool factory, hooks, and any other
  // component that needs to surface a UI notification.
  const toastService = new ToastService(session, {
    enabled: memConfig.contextCompression?.enabled ?? true,
    mode: memConfig.contextCompression?.notificationMode ?? "chat",
  });
  // Shared per-session compress state is module-level in
  // application/context-compression/state.ts — both the tool factory and the
  // transform handler import it directly (no threading needed).

  const handlers = createHookHandlers(
    store, session, memConfig,
    ruleCache, ruleCacheDirty, sessionInjectionLock, latestUserMessage,
    { start: ensureManagementServer, stop: stopManagementServer },
    currentSessionId,
    directory,
  );
  const toolMap = createToolMap(store, journalTools, session, journalStore, journalCtx, memConfig, toastService, directory);

  memLog("info", "init", "Plugin initialization completed", { totalDurationMs: perfNow() - t0 });

  const composedMessage = async (event: PromptEvent) => {
    currentSessionId.value = event.sessionID;
    incrementTurn();
    memLog("info", "live-capture", "composedMessage called", {
      sessionID: event.sessionID,
      hasHandler: !!handlers["message"],
    });
    await handlers["message"]?.(event);
  };

  const capturedMessageCounts = new Map<string, number>();
  const turnIndexCounters = new Map<string, number>();

  function nextTurnIndex(sessionId: string): number {
    const cur = turnIndexCounters.get(sessionId) ?? 0;
    turnIndexCounters.set(sessionId, cur + 1);
    return cur;
  }

  const composedMessagesTransform = async (event: MessagesEvent) => {
    const messages = event.messages;
    const sid = currentSessionId.value;

    if (sid && messages && messages.length > 0) {
      const sysText = messages
        .filter((m) => m.role === "system")
        .map((m) => (m.parts || []).map((p) => p.text || "").join(" "))
        .join("\n");
      memLog("debug", "tool-map", "SYSTEM-PROMPT-TOOL-SCAN", {
        sysLen: sysText.length,
        roles: [...new Set(messages.map((m) => m.role ?? "?"))].join(","),
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
          const role = msg.role;
          if (role !== "user" && role !== "assistant") continue;
          const partText = (msg.parts || []).map((p) => p.text || "").join("");
          const fullContent = partText;
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

    await autoRetrieveHook?.["messages"]?.(event);
    await handlers["messages"]?.(event);
  };

  const dispose = async () => {
    await store.close();
  };

  return {
    handlers,
    toolMap,
    composedMessage,
    composedMessagesTransform,
    dispose,
  };
}

/**
 * Plugin entrypoint.
 *
 * The plugin registers its hooks on the domain that owns the operation and
 * the tool map on the tool registry.
 */
async function setupPlugin(ctx: PluginContext): Promise<() => Promise<void>> {
  const directory = resolveProjectDirectory(ctx.location);
  const session = createSessionApi(ctx as unknown as Parameters<typeof createSessionApi>[0]);
  const core = await getCore(directory, session);

  let released = false;
  return registerPlugin(ctx, {
    handlers: {
      ...core.handlers,
      "message": core.composedMessage,
      "messages": core.composedMessagesTransform,
    },
    toolMap: core.toolMap,
    dispose: async () => {
      if (released) return;
      released = true;
      await releaseCore(directory);
    },
  });
}

/**
 * Plugin entrypoint.
 *
 * The runtime loads the package directory, resolves the `index` entrypoint to
 * this module, and calls `setup(ctx)` once per location.
 */
export default {
  id: "opencode-fractal-memory",
  setup: setupPlugin,
};
