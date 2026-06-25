import { createJournalStore } from "../application/journal";
import * as tools from "../tools";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { memLog } from "../logging";
import type { MemConfig } from "../infrastructure/config/config";
import { scheduleBackgroundEmbeddings } from "../infrastructure/composition-root";

export { scheduleBackgroundEmbeddings };

export async function setupJournal(directory: string, memConfig: MemConfig): Promise<Record<string, ToolDefinition>> {
  if (!memConfig.journal?.enabled) return {};

  const journalStore = createJournalStore();
  return {
    journal_write: tools.JournalWrite(journalStore, { directory, model: "", provider: "" }),
    journal_read: tools.JournalRead(journalStore),
    journal_search: tools.JournalSearch(journalStore),
  };
}
