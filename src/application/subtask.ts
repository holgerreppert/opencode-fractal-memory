import type { MemorySubtask } from "../domain/ports/MemoryStore";

export interface ToolCallLike {
  toolName: string;
  success: boolean | null;
  command?: string | null;
}

const EDITING_TOOLS = new Set(["edit", "write", "replace", "apply_patch"]);
const LOCALIZATION_TOOLS = new Set(["read"]);
const ANALYSIS_TOOLS = new Set(["grep", "glob", "search", "skeletonize"]);
const SHELL_TOOLS = new Set(["bash", "shell"]);
const VALIDATION_COMMAND = /\b(test|tests|build|lint|typecheck|tsc|pytest|jest|vitest|cargo (build|test)|go (build|test)|make)\b/i;

/**
 * Subtask-aligned retrieval (Shen 2602.21611): classify a tool-call trace into
 * one of four coding phases so retrieval can boost memories from matching
 * phases. Dominant category by count; ties break validation > editing >
 * analysis > localization (a session that edited AND verified is a
 * validation story). Returns null when no signal exists.
 */
export function inferSubtask(calls: readonly ToolCallLike[]): MemorySubtask | null {
  let analysis = 0;
  let localization = 0;
  let editing = 0;
  let validation = 0;
  for (const call of calls) {
    const tool = call.toolName.toLowerCase();
    if (EDITING_TOOLS.has(tool)) editing++;
    else if (LOCALIZATION_TOOLS.has(tool)) localization++;
    else if (ANALYSIS_TOOLS.has(tool) || tool.startsWith("graph")) analysis++;
    else if (SHELL_TOOLS.has(tool) && call.command && VALIDATION_COMMAND.test(call.command)) validation++;
  }
  const scores: ReadonlyArray<[MemorySubtask, number]> = [
    ["validation", validation],
    ["editing", editing],
    ["analysis", analysis],
    ["localization", localization],
  ];
  let best: [MemorySubtask, number] | undefined;
  for (const entry of scores) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best && best[1] > 0 ? best[0] : null;
}
