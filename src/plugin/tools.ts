import type { MemoryStore } from "../storage/sqlite";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { createMemoryTool } from "../tools/consolidated/memory";
import { createContextTool } from "../tools/consolidated/context";
import { createLearnTool } from "../tools/consolidated/learn";
import { createJournalTool } from "../tools/consolidated/journal";
import { createGraphPluginTool } from "../tools/graph";
import { createSkeletonizeTool } from "../tools/consolidated/skeletonize";
import type { JournalStore, JournalContext } from "../application/journal";

export function createToolMap(
  store: MemoryStore,
  journalTools: Record<string, ToolDefinition>,
  client: unknown,
  journalStore: JournalStore | null,
  journalCtx: JournalContext,
) {
  return {
    memory: createMemoryTool(store),
    context: createContextTool(store, client),
    learn: createLearnTool(store, client),
    journal: createJournalTool(journalStore, journalCtx, store),
    graph: createGraphPluginTool(),
    skeletonize: createSkeletonizeTool(),
  };
}
