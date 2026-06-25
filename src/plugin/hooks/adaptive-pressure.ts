import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import {
  resetPressureState,
  recordOutput,
  getEffectiveMaxLines,
  shouldSkipGeneric,
  getPressurePhase,
} from "../../application/adaptive-pressure";
import type { HookHandler } from "./types";

export function createAdaptivePressureHandler(config: MemConfig): HookHandler {
  const apConfig = config.adaptivePressure;
  if (apConfig?.enabled) {
    resetPressureState();
  }

  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      if (!apConfig?.enabled) return;
      const input = _input as { tool?: string; args?: { command?: string } };
      const out = output as { output?: string; metadata?: Record<string, unknown> };

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
