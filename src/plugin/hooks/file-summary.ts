import * as fs from "node:fs";
import type { MemoryStore, MemoryScope } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { writeFileSumLog } from "../../logging";
import { generateFileSummary, generateFileLabel, SOURCE_FILE_EXTENSIONS } from "../../application/file-summary";
import type { HookHandler } from "./types";

export function createFileSummaryHandler(store: MemoryStore, config: MemConfig): HookHandler {
  return {
    "tool.before": async (_input: unknown, output: unknown) => {
      const fileSummarization = config.autoFileSummarization;
      if (!fileSummarization?.enabled) return;
      const input = _input as { tool?: string; args?: Record<string, unknown> };
      if (input.tool !== "read") return;
      if (!input.args?.filePath) return;

      const filePath = input.args.filePath as string;
      const fileExt = filePath.split(".").pop() ?? "";
      if (!SOURCE_FILE_EXTENSIONS.includes(fileExt)) return;

      try {
        const shortLabel = generateFileLabel(filePath);
        let cached = null;
        try { cached = await store.getNodeByLabel("project", shortLabel); } catch { /* not found */ }

        if (cached) {
          let isStale = false;
          try {
            const fileMtime = (await fs.promises.stat(filePath)).mtime;
            if (fileMtime.getTime() > cached.updatedAt.getTime()) {
              isStale = true;
            }
          } catch { /* stat failed */ }

          if (isStale) {
            writeFileSumLog("FILE-SUMMARIZE", { action: "cache-stale", file: filePath, label: shortLabel });
          } else {
            (output as { output?: string }).output = cached.content;
            (output as { metadata?: Record<string, unknown> }).metadata = {
              ...((output as { metadata?: Record<string, unknown> }).metadata ?? {}),
              cached: true,
            };
            writeFileSumLog("FILE-SUMMARIZE", { action: "cache-hit", file: filePath, label: shortLabel, cached_chars: cached.content.length });
          }
        } else {
          writeFileSumLog("FILE-SUMMARIZE", { action: "cache-miss", file: filePath, label: shortLabel });
        }
      } catch (err) {
        writeFileSumLog("FILE-SUMMARIZE", { action: "error", file: filePath, error: String(err).slice(0, 120) });
      }
    },
    "tool.after": async (_input: unknown, output: unknown) => {
      const fileSummarization = config.autoFileSummarization;
      if (!fileSummarization?.enabled) return;
      const input = _input as { tool?: string; args?: Record<string, unknown> };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      if (input.tool !== "read") return;
      if (!input.args?.filePath) return;

      const isCached = (out.metadata as { cached?: boolean } | undefined)?.cached === true;
      if (isCached) return;

      const filePath = input.args.filePath as string;
      const fileName = filePath.split("/").pop() ?? filePath;
      const fileExt = fileName.split(".").pop() ?? "";
      if (!SOURCE_FILE_EXTENSIONS.includes(fileExt)) return;

      try {
        const shortLabel = generateFileLabel(filePath);
        let existingNode = null;
        try { existingNode = await store.getNodeByLabel("project", shortLabel); } catch { /* not found */ }

        let fullContent = "";
        try {
          fullContent = await fs.promises.readFile(filePath, "utf-8");
        } catch {
          fullContent = String(out.output ?? "");
        }

        const content = generateFileSummary(fileName, filePath, fullContent, fileExt);
        const summaryLines = content.split("\n").length;

        if (existingNode) {
          await store.updateNode(existingNode.id, { content });
          writeFileSumLog("FILE-SUMMARIZE", { action: "updated", file: filePath, label: shortLabel, summary_lines: summaryLines, lines: fullContent.split("\n").length });
        } else {
          try {
            await store.createNode({
              scope: "project",
              label: shortLabel,
              content,
              type: "note",
              level: 0,
              parentIds: null,
              embedding: null,
              importance: 0.7,
              usefulnessScore: 0.3,
            });
            writeFileSumLog("FILE-SUMMARIZE", { action: "created", file: filePath, label: shortLabel, summary_lines: summaryLines, lines: fullContent.split("\n").length });
          } catch (createErr) {
            const errMsg = String(createErr);
            if (errMsg.includes("UNIQUE constraint")) {
              try {
                const fallback = await store.getNodeByLabel("project", shortLabel);
                await store.updateNode(fallback.id, { content });
                writeFileSumLog("FILE-SUMMARIZE", { action: "race-recovered", file: filePath, label: shortLabel, summary_lines: summaryLines });
              } catch {
                writeFileSumLog("FILE-SUMMARIZE", { action: "error", file: filePath, label: shortLabel, error: "race-recovery-failed" });
              }
            }
          }
        }
      } catch (err) {
        /* best-effort */
      }
    },
  };
}
