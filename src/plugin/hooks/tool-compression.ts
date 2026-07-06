import type { HookHandler } from "./types";
import { memLog } from "../../logging";
import { compressReadOutput, compressGlobOutput, compressEditOutput } from "../../application/tool-compression";

export function createNonBashCompressionHandler(): HookHandler {
  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: { command?: string; filePath?: string; path?: string; pattern?: string }; sessionID?: string };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      const tool = input.tool;

      if (!tool || tool === "bash") return;

      const raw = (out.output ?? "") as string;
      if (!raw || raw.length < 80) return;

      let result: { output: string; strategy: string } | null = null;

      if (tool === "read") {
        const filePath = input.args?.filePath ?? input.args?.path ?? "";
        result = compressReadOutput(raw, filePath);
      } else if (tool === "glob") {
        const pattern = input.args?.pattern ?? "";
        result = compressGlobOutput(raw, pattern);
      } else if (tool === "edit") {
        result = compressEditOutput(raw);
      }

      if (result && result.output.length < raw.length) {
        // Only apply if meaningful compression
        const savings = raw.length - result.output.length;
        const savingsPct = Math.round((savings / raw.length) * 100);
        if (savingsPct < 10) return;

        out.output = `[Compressed via ${result.strategy} — ${raw.length}→${result.output.length} chars (${savingsPct}% saved)]\n${result.output}`;
        out.metadata = {
          ...((out.metadata as Record<string, unknown>) ?? {}),
          compressed: true,
          compressStrategy: result.strategy,
        };

        memLog("debug", "tool-compress", `Compressed ${tool} output`, {
          strategy: result.strategy,
          original: raw.length,
          compressed: result.output.length,
          saving: `${savingsPct}%`,
        });
      }
    },
  };
}
