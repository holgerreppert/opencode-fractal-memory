import type { MemConfig } from "../../infrastructure/config/config";
import { getPressurePhase } from "../../application/adaptive-pressure";
import { writeCompressLog } from "../../logging";
import type { HookHandler } from "./types";

export function createChatParamsHandler(config: MemConfig): HookHandler {
  const apConfig = config.adaptivePressure;
  if (!apConfig?.enabled) {
    return {};
  }

  return {
    "chat.params": async (_input: unknown, output: unknown) => {
      const phase = getPressurePhase(apConfig);
      if (phase === "normal") return;

      const out = output as {
        temperature: number;
        topP: number;
        topK: number;
        maxOutputTokens: number | undefined;
        options: Record<string, unknown>;
      };

      switch (phase) {
        case "warn":
          out.temperature = Math.min(out.temperature, 0.5);
          out.maxOutputTokens = out.maxOutputTokens
            ? Math.min(out.maxOutputTokens, 4096)
            : 4096;
          break;
        case "aggressive":
          out.temperature = Math.min(out.temperature, 0.2);
          out.maxOutputTokens = out.maxOutputTokens
            ? Math.min(out.maxOutputTokens, 2048)
            : 2048;
          break;
        case "critical":
          out.temperature = Math.min(out.temperature, 0.1);
          out.maxOutputTokens = out.maxOutputTokens
            ? Math.min(out.maxOutputTokens, 1024)
            : 1024;
          break;
      }

      writeCompressLog({
        action: "chat-params",
        strategy: "adaptive-pressure",
        cmd_preview: `temperature=${out.temperature}, maxTokens=${out.maxOutputTokens}`,
        original_chars: 0,
        compressed_chars: 0,
        original_lines: 0,
        compressed_lines: 0,
        reduction_pct: 0,
        duration_ms: 0,
        failed: 0,
      });
    },
  };
}
