import type { MemoryStore } from "../storage/sqlite";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { MemConfig } from "../infrastructure/config/config";
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
  memConfig: MemConfig,
) {
  const rerankMode = memConfig.ollama?.strategy === "cross-encoder" ? "cross-encoder" : memConfig.ollama?.strategy === "llm" ? "keyword" : undefined;
  return {
    memory: createMemoryTool(store, rerankMode),
    context: createContextTool(store, client),
    learn: createLearnTool(store, client),
    journal: createJournalTool(journalStore, journalCtx, store),
    graph: createGraphPluginTool(),
    skeletonize: createSkeletonizeTool(),
  };
}
