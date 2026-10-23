import type { MemConfig } from "../../infrastructure/config/config";
import {
  resetPressureState,
  recordOutput,
  getEffectiveMaxLines,
  shouldSkipGeneric,
  getPressurePhase,
} from "../../application/adaptive-pressure";
import type { PluginHooks, ToolAfterEvent } from "./types";

export function createAdaptivePressureHandler(config: MemConfig): PluginHooks {
  const apConfig = config.adaptivePressure;
  if (apConfig?.enabled) {
    resetPressureState();
  }

  return {
    "tool.execute.after": async (event: ToolAfterEvent) => {
      if (!apConfig?.enabled) return;
      const input = event as unknown as { tool?: string; args?: { command?: string } };
      const out = event as unknown as { output?: string; metadata?: Record<string, unknown> };

      if (input.tool !== "bash") return;

      const raw = (out.output ?? "") as string;
      if (!raw) return;

      const warning = recordOutput(raw, apConfig);

      if (warning) {
        out.output = warning + "\n" + raw;
      }
    },
  };
}

export { getEffectiveMaxLines, shouldSkipGeneric, getPressurePhase };
