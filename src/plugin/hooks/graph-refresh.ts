import { readFileSync } from "node:fs";
import type { MemConfig } from "../../infrastructure/config/config";
import { ensureBackgroundGraph, getActiveGraph, refreshGraphFile } from "../../application/graph/build";
import { setGraphCacheEnabled } from "../../application/graph/persist";
import { trackFileRefresh, writePluginGraphUsage } from "../../application/graph/usage";
import type { PluginHooks, ToolAfterEvent } from "./types";
import { writeGraphLog, writeFileSumLog } from "../../logging";

export function createGraphRefreshHandler(config: MemConfig, directory: string): PluginHooks {
  const graphConfig = config.graph ?? { enabled: false, maxFiles: 5000, refreshEnabled: true, cacheEnabled: true };

  if (!graphConfig.enabled) return {};
  if (!graphConfig.refreshEnabled) return {};

  setGraphCacheEnabled(graphConfig.cacheEnabled !== false);

  // Never build at plugin init: the first real need (an edit/write) triggers it.
  const root = directory;
  const maxFiles = graphConfig.maxFiles ?? 5000;

  return {
    "tool.execute.after": async (event: ToolAfterEvent) => {
      const input = event as unknown as { tool?: string; args?: { filePath?: string } };
      const tool = input.tool;
      const filePath = input.args?.filePath;
      if (!filePath) return;
      if (!getActiveGraph()) ensureBackgroundGraph(root, maxFiles);

      if (tool === "edit" || tool === "write") {
        try {
          const content = readFileSync(filePath, "utf-8");
          if (content.length < 100) return;
          refreshGraphFile(filePath, content);
          trackFileRefresh("plugin-hook");
          writeGraphLog("info", "File refreshed", { file: filePath, chars: content.length });
          writePluginGraphUsage();
          writeFileSumLog("GRAPH-TOOLS", { action: "refreshed-file", file: filePath, chars: content.length });
        } catch {
          writeGraphLog("warn", "File refresh failed", { file: filePath });
          writeFileSumLog("GRAPH-TOOLS", { action: "refresh-failed", file: filePath });
        }
      }
    },
  };
}
