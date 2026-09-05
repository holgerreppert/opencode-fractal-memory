import type { MemoryStore } from "../storage/sqlite";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { MemConfig } from "../infrastructure/config/config";
import { memLog } from "../logging";
import { createMemoryTool } from "../tools/consolidated/memory";
import { createContextTool } from "../tools/consolidated/context";
import { createLearnTool } from "../tools/consolidated/learn";
import { createJournalTool } from "../tools/consolidated/journal";
import { createGraphPluginTool } from "../tools/graph";
import { createSkeletonizeTool } from "../tools/consolidated/skeletonize";
import { createContextCompressTool } from "../tools/context-compress";
import { createSessionMessagesTool } from "../tools/session-messages";
import { createExpandTool } from "../tools/expand";
import { ToastService } from "../infrastructure/toast-service";
import type { JournalStore, JournalContext } from "../application/journal";

export function createToolMap(
  store: MemoryStore,
  journalTools: Record<string, ToolDefinition>,
  client: unknown,
  journalStore: JournalStore | null,
  journalCtx: JournalContext,
  memConfig: MemConfig,
  toastService: ToastService,
) {
  const rerankMode = memConfig.ollama?.strategy === "cross-encoder" ? "cross-encoder" : memConfig.ollama?.strategy === "llm" ? "keyword" : undefined;
  const compressTool = createContextCompressTool(store, client, memConfig, toastService);
  memLog("info", "tool-map", "CREATED archivecontext tool", {
    toolID: "archivecontext",
    hasExecute: typeof (compressTool as { execute?: unknown }).execute === "function",
    argKeys: Object.keys(((compressTool as { args?: object }).args ?? {})),
    description: ((compressTool as { description?: string }).description ?? "").slice(0, 80),
  });
  const map = {
    archivecontext: compressTool,
    expand: createExpandTool(),
    memory: createMemoryTool(store, rerankMode),
    context: createContextTool(store, client),
    learn: createLearnTool(store, client),
    journal: createJournalTool(journalStore, journalCtx, store),
    graph: createGraphPluginTool(),
    skeletonize: createSkeletonizeTool(),
    memory_session_messages: createSessionMessagesTool(client),
  };
  memLog("info", "tool-map", "TOOL-MAP-RETURNED", { keys: Object.keys(map) });
  return map;
}
