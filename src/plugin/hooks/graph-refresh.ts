import { readFileSync } from "node:fs";
import type { MemConfig } from "../../infrastructure/config/config";
import { ensureBackgroundGraph, refreshGraphFile } from "../../application/graph/build";
import { setGraphCacheEnabled } from "../../application/graph/persist";
import { trackFileRefresh, writePluginGraphUsage } from "../../application/graph/usage";
import type { HookHandler } from "./types";
import { writeGraphLog, writeFileSumLog } from "../../logging";

export function createGraphRefreshHandler(config: MemConfig): HookHandler {
  const graphConfig = config.graph ?? { enabled: false, maxFiles: 5000, refreshEnabled: true, cacheEnabled: true };

  if (!graphConfig.enabled) return {};
  if (!graphConfig.refreshEnabled) return {};

  setGraphCacheEnabled(graphConfig.cacheEnabled !== false);

  const root = process.cwd();
  const maxFiles = graphConfig.maxFiles ?? 5000;

  ensureBackgroundGraph(root, maxFiles);

  return {
    "tool.after": async (_input: unknown, _output: unknown) => {
      const input = _input as { tool?: string; args?: { filePath?: string } };
      const tool = input.tool;
      const filePath = input.args?.filePath;
      if (!filePath) return;

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
