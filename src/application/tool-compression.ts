import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

export interface ToolCompressResult {
  output: string;
  strategy: string;
}

const SCRATCH_DIR = path.join(os.homedir(), ".config", "opencode", "scratch");
const MIN_TOOL_OUTPUT = 80;

function ensureScratchDir(): void {
  try { fs.mkdirSync(SCRATCH_DIR, { recursive: true }); } catch { /* best-effort */ }
}

export function stashOriginal(output: string): string | null {
  if (!output || output.length < 200) return null;
  ensureScratchDir();
  const hash = createHash("sha256").update(output).digest("hex").slice(0, 16);
  const outPath = path.join(SCRATCH_DIR, `${hash}.out`);
  try {
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, output, "utf-8");
    }
    return outPath;
  } catch {
    return null;
  }
}

export function applyToolWordAbbreviations(text: string): string {
  const WORD_ABBRS: Record<string, string> = {
    implementation: "impl", configuration: "config", authentication: "auth",
    authorization: "authz", directory: "dir", executable: "exe",
    environment: "env", variable: "var", function: "fn", property: "prop",
    parameter: "param", argument: "arg", attribute: "attr", reference: "ref",
    identifier: "id", initialization: "init", repository: "repo",
    management: "mgmt", application: "app", documentation: "docs",
    notification: "notif", communication: "comm", utility: "util",
  };
  let changed = false;
  const result = text.split("\n").map(line => {
    const updated = line.replace(/\b([a-zA-Z]{6,})\b/g, (match) => {
      const lower = match.toLowerCase();
      const abbrev = WORD_ABBRS[lower];
      if (abbrev) { changed = true; return match[0]!.toUpperCase() === match[0] ? abbrev[0]!.toUpperCase() + abbrev.slice(1) : abbrev; }
      return match;
    });
    return updated;
  });
  return changed ? result.join("\n") : text;
}

export function compressReadOutput(raw: string, filePath?: string): ToolCompressResult | null {
  if (!raw || raw.length < MIN_TOOL_OUTPUT) return null;

  const lines = raw.split("\n");

  // Trim leading/trailing blank lines
  let start = 0, end = lines.length - 1;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end]!.trim() === "") end--;
  let trimmed = lines.slice(start, end + 1);

  // Collapse consecutive blank lines to at most 1
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of trimmed) {
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }

  // For JSON: structural summary
  if (filePath?.endsWith(".json") || raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      const summary = summarizeJSON(parsed);
      if (summary && summary.length < raw.length) {
        return { output: summary, strategy: "read-json-struct" };
      }
    } catch { /* not valid JSON, fall through */ }
  }

  // For source files: shorten long import lines
  if (filePath?.match(/\.(ts|js|tsx|jsx|mjs|cjs|py|rs|go|java)$/)) {
    const processed = collapsed.map(line => {
      const trimmed_line = line.trim();
      // Shorten: import { A, B, C, D, E, F, ... } → import { A, B, C, ... N more }
      if (/^(import|from|require|use|using)\s/.test(trimmed_line) && line.length > 120) {
        const match = trimmed_line.match(/\{[^}]+\}/);
        if (match) {
          const items = match[0].replace(/[{}]/g, "").split(",").map(s => s.trim()).filter(Boolean);
          if (items.length > 4) {
            const short = items.slice(0, 4).join(", ");
            return line.replace(match[0], `{ ${short}, ... ${items.length - 4} more }`);
          }
        }
      }
      // Shorten very long identifiers in imports -> single line
      if (trimmed_line.startsWith("import ") || trimmed_line.startsWith("use ") || trimmed_line.startsWith("using ")) {
        return line; // keep as-is, imports are important
      }
      return line;
    });
    collapsed.splice(0, collapsed.length, ...processed);
  }

  // Truncate very long lines
  const maxLineLen = 500;
  const withTruncatedLines = collapsed.map(line => {
    if (line.length > maxLineLen) return line.slice(0, maxLineLen) + ` … [${line.length - maxLineLen} more chars]`;
    return line;
  });

  const result = withTruncatedLines.join("\n");
  if (result.length >= raw.length) return null;

  return {
    output: result,
    strategy: "read-compact",
  };
}

function summarizeJSON(data: unknown, depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) return typeof data;
  if (Array.isArray(data)) {
    if (data.length === 0) return "[]";
    const first = data[0];
    if (data.length <= 3) return JSON.stringify(data.length <= 1 ? data : `[${data.length} items]`);
    return `[${data.length} items]${first ? ` (e.g. ${JSON.stringify(first).slice(0, 60)})` : ""}`;
  }
  if (typeof data === "object" && data !== null) {
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    if (keys.length <= 5) return `{ ${keys.join(", ")} }`;
    return `{ ${keys.length} keys: ${keys.slice(0, 5).join(", ")}, ... }`;
  }
  return String(data).slice(0, 80);
}

export function compressGlobOutput(raw: string, pattern?: string): ToolCompressResult | null {
  if (!raw || raw.length < MIN_TOOL_OUTPUT) return null;

  const entries = raw.split("\n").filter(Boolean);
  if (entries.length <= 5) return null;

  // Group by directory
  const dirs = new Map<string, string[]>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const lastSlash = trimmed.lastIndexOf("/");
    const dir = lastSlash >= 0 ? trimmed.slice(0, lastSlash) : ".";
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed);
  }

  const parts: string[] = [];
  let totalFiles = 0;
  let nodeModulesFiles = 0;

  for (const [dir, files] of dirs) {
    totalFiles += files.length;
    if (dir.includes("node_modules")) {
      nodeModulesFiles += files.length;
      continue;
    }
    if (files.length === 1) {
      parts.push(`${dir}/${files[0]}`);
    } else if (files.length <= 5) {
      parts.push(`${dir}/ [${files.length} files]`);
      for (const f of files.slice(0, 3)) parts.push(`  ${f}`);
      if (files.length > 3) parts.push(`  … ${files.length - 3} more`);
    } else {
      parts.push(`${dir}/ [${files.length} files]`);
      parts.push(`  ${files[0]}`);
      parts.push(`  … ${files.length - 2} more`);
      parts.push(`  ${files[files.length - 1]}`);
    }
  }

  if (nodeModulesFiles > 0) {
    parts.push(`node_modules/ [${nodeModulesFiles} files collapsed]`);
  }

  const result = parts.join("\n");
  if (result.length >= raw.length) return null;

  return {
    output: `${entries.length} results for \`${pattern ?? ""}\`:\n${result}`,
    strategy: "glob-grouped",
  };
}

export function compressEditOutput(raw: string): ToolCompressResult | null {
  if (!raw || raw.length < MIN_TOOL_OUTPUT) return null;

  const lines = raw.split("\n");
  if (lines.length <= 3) return null;

  // Edits usually show "Edited file X: N lines changed" — compress any large trailing content
  const header = lines.slice(0, 2).join("\n");
  const body = lines.slice(2);

  if (body.length === 0) return null;

  const compressedBody = body.slice(0, 10);
  if (body.length > 10) {
    compressedBody.push(`… ${body.length - 10} more lines`);
  }

  const result = [header, ...compressedBody].join("\n");
  if (result.length >= raw.length) return null;

  return { output: result, strategy: "edit-truncated" };
}
