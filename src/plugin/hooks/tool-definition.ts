import type { HookHandler } from "./types";
import { memLog } from "../../logging";

interface ToolDefinitionInput {
  toolID: string;
}

interface ToolDefinitionOutput {
  description: string;
  parameters: unknown;
}

const TIPS: Record<string, string> = {
  read: "\n\nTip: Before editing a file, use `graph(relation='dependents', file='<path>')` to see what depends on it. Use `memory(mode='search', query='<topic>')` for relevant past context.",
  edit: "\n\nTip: Before editing, use `graph(relation='callers', name='<function>')` to check what depends on the function you're changing, or `graph(relation='dependents', file='<path>')` for change impact.",
  grep: "\n\nTip: Use `graph(relation='search', query='<symbol>')` for symbol-aware search — it understands code structure and finds definitions/references.",
  glob: "\n\nTip: Use `graph(relation='search', query='<name>')` to find symbols by name across the codebase — faster and more precise than glob.",
  bash: "\n\nTip: For code exploration, prefer `grep`/`glob`/`graph` tools over shell commands — they're more token-efficient and safer.",
  memory_set: "\n\nTip: Worth storing: architecture decisions (why), bug root causes, project conventions, user preferences, config workarounds, anti-patterns. Skip: code content (in files), verbose logs, ephemeral details. Use semantic type for permanent knowledge, episodic type for session-scoped traces.",
};

export function createToolDefinitionHandler(): HookHandler {
  return {
    "tool.definition": async (_input: unknown, output: unknown) => {
      const input = _input as ToolDefinitionInput;
      const out = output as ToolDefinitionOutput;

      const tip = TIPS[input.toolID];
      if (!tip) return;

      if (out.description) {
        out.description += tip;
        memLog("debug", "tool-definition", `Augmented ${input.toolID} description`, {
          toolID: input.toolID,
          addedLength: tip.length,
        });
      }
    },
  };
}
