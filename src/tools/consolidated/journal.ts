import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { MemoryStore } from "../../storage/sqlite";
import type { JournalStore, JournalContext } from "../../application/journal";
import { JournalWrite, JournalRead, JournalSearch } from "../journal";
import { migrateJournalFiles } from "./journal-migrate";

export function createJournalTool(store: JournalStore | null, ctx: JournalContext, memoryStore?: MemoryStore | undefined) {
  if (!store) {
    const t = tool({
      description: "Journal tool — journal is disabled in config.",
      args: { mode: tool.schema.enum(["write", "read", "search", "migrate"]) },
      async execute() {
        return "Journal is not enabled. Enable `journal.enabled` in opencode-mem.json config.";
      },
    });
    return t;
  }

  const migrateFn = memoryStore
    ? async () => {
        const result = await migrateJournalFiles(memoryStore);
        const lines = [`Imported ${result.imported} journal entries, skipped ${result.skipped}.`];
        if (result.errors.length > 0) {
          lines.push(`Errors: ${result.errors.length}`);
          for (const e of result.errors.slice(0, 10)) {
            lines.push(`  ${e.file}: ${e.error}`);
          }
        }
        return lines.join("\n");
      }
    : undefined;

  const handlers: Record<string, ToolDefinition> = {
    write: JournalWrite(store, ctx),
    read: JournalRead(store),
    search: JournalSearch(store),
    migrate: {
      description: "Migrate existing file-based journal entries into memory nodes",
      args: {},
      execute: migrateFn ?? (async () => "Migration requires memory store access."),
    } as ToolDefinition,
  };

  const t = tool({
    description: `AFTER COMPLETING SIGNIFICANT TASKS: preserve decisions and context across sessions.

MODES:
  write   — Create a new journal entry. USE AFTER completing significant tasks
  read    — Read a specific journal entry by ID
  search  — Search entries by semantic similarity, tags, or project
  migrate — Import existing file-based journal entries into memory nodes

WORKFLOW:
  write (capture) → search (find) → read (review)

TIP: journal(mode="write") after every significant task — ensures session continuity.
TIP: Add descriptive tags to every entry — they power search and cross-session retrieval.`,
    args: {
      mode: tool.schema.enum(["write", "read", "search", "migrate"]).describe("Which journal operation to perform"),
      title: tool.schema.string().optional(),
      body: tool.schema.string().optional(),
      tags: tool.schema.string().optional(),
      id: tool.schema.string().optional(),
      text: tool.schema.string().optional(),
      project: tool.schema.string().optional(),
      limit: tool.schema.number().int().positive().optional(),
      offset: tool.schema.number().int().nonnegative().optional(),
    },
    async execute(args, toolCtx) {
      const mode = args.mode as string;
      if (mode === "migrate" && migrateFn) {
        return migrateFn();
      }
      const handler = handlers[mode];
      if (!handler) {
        return `Unknown mode: ${mode}. Available modes: ${Object.keys(handlers).join(", ")}`;
      }
      return handler.execute(args, toolCtx);
    },
  });

  return t;
}
