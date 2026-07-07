import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import type { HookHandler } from "./types";

export interface ErrorPruningConfig {
  enabled: boolean;
  turns: number;
  protectedTools: string[];
}

export function createErrorPruneHandler(config: MemConfig): HookHandler {
  const epConfig = config.errorPruning as ErrorPruningConfig | undefined;
  if (!epConfig?.enabled) return {};

  let turnCounter = 0;

  return {
    "tool.before": async () => {
      turnCounter++;
    },

    "chat.messages.transform": async (_input: unknown, output: unknown) => {
      const out = output as {
        messages: Array<{
          info: { role?: string };
          parts: Array<{
            type?: string;
            name?: string;
            state?: { status?: string; input?: Record<string, unknown> };
          }>;
        }>;
      };

      if (!out.messages) return;

      let prunedCount = 0;

      for (const msg of out.messages) {
        if (!msg.parts) continue;

        for (const part of msg.parts) {
          if (part.type !== "tool_use") continue;
          if (part.state?.status !== "error") continue;

          const toolName = part.name ?? "";
          if (epConfig.protectedTools?.includes(toolName)) continue;

          const input = part.state?.input;
          if (!input) continue;

          let modified = false;
          for (const key of Object.keys(input)) {
            if (typeof input[key] === "string" && (input[key] as string).length > 20) {
              input[key] = "[input pruned after failed tool call]";
              modified = true;
            }
          }

          if (modified) prunedCount++;
        }
      }

      if (prunedCount > 0) {
        memLog("debug", "error-prune", `Pruned ${prunedCount} errored tool inputs`, {
          turn: turnCounter,
        });
      }
    },
  };
}
