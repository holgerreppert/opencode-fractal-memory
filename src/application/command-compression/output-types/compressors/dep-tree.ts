import type { OutputTypeResult } from "../types";

export function compressDepTree(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const topLevel: string[] = [];
  let totalDeps = 0;
  let errors: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (/^(?:│|├──|└──)/.test(t.replace(/^\s{2,}/, "")) === false && !t.startsWith("├──") && !t.startsWith("└──") && !t.startsWith("│")) {
      if (t && !t.startsWith(" ") && !t.startsWith("│") && !t.startsWith("├") && !t.startsWith("└")) {
        if (topLevel.length < 10) topLevel.push(t.replace(/@\d+\.\d+.*$/, "@ver"));
      }
    }
    if (t) totalDeps++;
    if (/\b(ERR|error|not found|missing|UNMET)\b/i.test(t)) errors.push(t);
  }

  const result: string[] = [];
  if (topLevel.length > 0) result.push(`packages (${topLevel.length}): ${topLevel.join(", ")}`);
  result.push(`total deps: ${totalDeps}`);
  if (errors.length > 0) result.push(`errors: ${errors.slice(0, 3).join("; ")}`);
  if (result.length === 1) result.push(lines.slice(0, 3).join("\n"));

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "dep-tree", compressed };
}
