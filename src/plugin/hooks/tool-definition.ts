import type { HookHandler } from "./types";
import { memLog } from "../../logging";

interface ToolDefinitionInput {
  toolID: string;
}

interface ToolDefinitionOutput {
  description: string;
  parameters: unknown;
  jsonSchema?: unknown;
}

function describeParams(p: unknown): Record<string, unknown> {
  if (p == null) return { kind: "null" };
  const t = typeof p;
  if (t !== "object") return { kind: t };
  const o = p as Record<string, unknown>;
  const std = o["~standard"] as Record<string, unknown> | undefined;
  return {
    kind: "object",
    keys: Object.keys(o),
    hasStandard: !!std,
    stdVendor: std?.vendor,
    stdHasJsonSchema: !!std?.jsonSchema,
    stdHasValidate: typeof std?.validate === "function",
    hasZod: "_zod" in o,
    hasVerceAi: Symbol.for("vercel.ai.schema") in o,
    ctor: (o as { constructor?: { name?: string } }).constructor?.name,
  };
}

const TIPS: Record<string, string> = {
  read: "\n\nTip: Before reading, use `memory(mode='search')` first — it's 100× cheaper than reading files blind. For large files, use `skeletonize(path)` for a compact symbol overview. Before editing, use `graph(relation='dependents', file='<path>')` to see what depends on it.",
  edit: "\n\nTip: Before editing, use `graph(relation='callers', name='<function>')` to check what depends on the function you're changing, or `graph(relation='dependents', file='<path>')` for change impact.",
  grep: "\n\nTip: Use `graph(relation='search', query='<symbol>')` for symbol-aware search — it understands code structure and finds definitions/references. Much faster than grep across large codebases.",
  glob: "\n\nTip: Use `graph(relation='search', query='<name>')` to find symbols by name across the codebase — faster and more precise than glob. Use `memory(mode='search')` to find related context.",
  bash: "\n\nTip: For code exploration, prefer `grep`/`glob`/`graph` tools over shell commands — they're more token-efficient and safer. Use `context(mode='check')` before starting complex bash pipelines.",
  memory_set: "\n\nTip: Worth storing: architecture decisions (why), bug root causes, project conventions, user preferences, config workarounds, anti-patterns. Skip: code content (in files), verbose logs, ephemeral details. Use semantic type for permanent knowledge, episodic type for session-scoped traces.",
  write: "\n\nTip: Before creating a new file, use `memory(mode='search')` for existing patterns and conventions. Use `graph(relation='imports', file='<similar>')` to understand the module's conventions.",
  search: "\n\nTip: For focused code lookup, use `graph(relation='search', query='<symbol>')` — it finds definitions more precisely. For conceptual context, use `memory(mode='search')` which retrieves past decisions and reasoning.",
  memory: "\n\nTip: Start every task with `memory(mode='search', query='...')` — it costs 100× less than reading code cold. Store discoveries with `memory(mode='set')`. Use `memory(mode='list')` to survey what's stored. Use `memory(mode='drilldown', id='...')` after search to get full context with source chain.",
  context: "\n\nTip: Run `context(mode='check')` before complex (3+ step) tasks to verify context pressure. If >60%, run `context(mode='compress')` immediately. After compaction, use `context(mode='recall')` to recover archived state. Use `context(mode='inject')` for automatic memory injection.",
  learn: "\n\nTip: At session end, run `learn(mode='reflect')` then `learn(mode='distill')` to extract rules from mistakes. After storing important information, run `learn(mode='verify')` to certify it (boosts confidence). Run `learn(mode='dashboard')` weekly for system health checks.",
  journal: "\n\nTip: After completing significant tasks, use `journal(mode='write')` to preserve decisions and context across sessions. Add descriptive tags to every entry — they power cross-session retrieval.",
  graph: "\n\nTip: Use `graph` BEFORE editing a function (`relation='callers'`) to check dependencies. Use `graph` AFTER finding a symbol (`relation='callees'`) to trace what it calls. Use `graph(relation='dependents', file='<path>')` for change impact. This is 10-100× more token-efficient than grep for dependency analysis.",
  skeletonize: "\n\nTip: Use `skeletonize(path)` instead of reading files >200 lines — it returns imports + symbol signatures at ~10% the token cost. Follow up with `read(path, offset=N)` for specific sections. Use `memory(mode='search')` for conceptual context about the file.",
};

export function createToolDefinitionHandler(): HookHandler {
  return {
    "tool.definition": async (_input: unknown, output: unknown) => {
      const input = _input as ToolDefinitionInput;
      const out = output as ToolDefinitionOutput;

      memLog("debug", "tool-definition", `TOOL-DEFINITION-CALLED ${input.toolID}`, {
        toolID: input.toolID,
        hasDescription: typeof out.description === "string",
        descriptionLen: typeof out.description === "string" ? out.description.length : -1,
        hasParams: out.parameters != null,
        paramsShape: describeParams(out.parameters),
        hasJsonSchema: out.jsonSchema != null,
        jsonSchemaKind: out.jsonSchema == null ? "null" : typeof out.jsonSchema,
      });

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
