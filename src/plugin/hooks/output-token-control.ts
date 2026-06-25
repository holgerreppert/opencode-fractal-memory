import type { MemConfig } from "../../config";
import type { HookHandler } from "./types";
import type { OutputTokenControlConfig } from "../../application/output-token-control";
import { getInjectionText, estimatePressureLevel, logOutputTokenInjection } from "../../application/output-token-control";

export function createOutputTokenControlHandler(config: MemConfig): HookHandler {
  const otcConfig = config.outputTokenControl as OutputTokenControlConfig | undefined;
  if (!otcConfig?.enabled) {
    return {};
  }

  return {
    "system.transform": async (_input: unknown, output: unknown) => {
      const input = _input as { args?: Record<string, unknown>; sessionID?: string };
      const out = output as { system: string[] };

      let userMessage = "";
      if (input.args?.userMessage) {
        userMessage = String(input.args.userMessage);
      }

      const pressureLevel = estimatePressureLevel(config.adaptivePressure);
      const ruleText = getInjectionText(otcConfig, userMessage, pressureLevel);

      if (!ruleText) return;

      const tag = `<system_reminder type="suggestion">\n${ruleText}\n</system_reminder>`;

      if (out.system.length > 0) {
        out.system.splice(1, 0, tag);
      } else {
        out.system.push(tag);
      }

      logOutputTokenInjection(pressureLevel, ruleText);
    },
  };
}
