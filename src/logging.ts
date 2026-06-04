import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOG_DIR = path.join(os.homedir(), ".config", "opencode", "logs");
const LOG_FILE = path.join(LOG_DIR, "memory-plugin.log");
const CONTEXT_DUMP_FILE = path.join(LOG_DIR, "context-dump.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024;

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

export type LogLevel = "debug" | "info" | "warn" | "error";

let currentSessionId: string | null = null;
let logLevel: LogLevel = "info";

// Categories to always skip (OpenCode core noise)
const SKIP_CATEGORIES = ["event"];

export function setSessionId(sessionId: string | null): void {
  currentSessionId = sessionId;
}

export function setLogLevel(level: LogLevel): void {
  logLevel = level;
}

function shouldLog(level: LogLevel, category?: string): boolean {
  if (SKIP_CATEGORIES.includes(category || "")) return false;
  const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return levels[level] >= levels[logLevel];
}

function writeLog(line: string): void {
  try {
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > MAX_LOG_SIZE) {
        fs.renameSync(LOG_FILE, LOG_FILE + ".old");
      }
    } catch { /* file doesn't exist yet */ }

    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch { /* silent fail */ }
}

export function memLog(
  level: LogLevel,
  category: string,
  msg: string,
  data?: Record<string, unknown>
): void {
  if (!shouldLog(level, category)) return;

  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const session = currentSessionId ? `[${currentSessionId.slice(0, 8)}]` : "";

  const line = `[${ts}] [${level.padEnd(5)}] [${category}]${session} ${msg}` +
    (Object.keys(data || {}).length > 0 ? ` ${JSON.stringify(data)}` : "");

  writeLog(line);
}

export function memLogSimple(msg: string, data?: Record<string, unknown>): void {
  memLog("info", "general", msg, data);
}

// Performance timing wrapper
const perfTimers = new Map<string, number>();

export function perfStart(label: string): void {
  perfTimers.set(label, Date.now());
}

export function perfEnd(label: string, category: string = "perf"): number | null {
  const start = perfTimers.get(label);
  if (!start) return null;
  const duration = Date.now() - start;
  memLog("debug", category, `${label} completed`, { durationMs: duration, label });
  perfTimers.delete(label);
  return duration;
}

export function perfNow(): number {
  return Date.now();
}

export function memLogInjection(
  action: "start" | "complete" | "skip",
  data: {
    nodes?: number;
    tokens?: number;
    mode?: string;
    query?: string;
    durationMs?: number;
    reason?: string;
    selectedIds?: string[];
  }
): void {
  switch (action) {
    case "start":
      memLog("info", "injection", "Memory injection started", {
        query: data.query?.slice(0, 100),
        mode: data.mode,
        nodeCount: data.nodes,
        estimatedTokens: data.tokens,
      });
      break;
    case "complete":
      const durationStr = data.durationMs ? ` (${data.durationMs}ms)` : "";
      memLog("info", "injection", `Injected ${data.selectedIds?.length || 0} nodes${durationStr}`, {
        nodes: data.nodes,
        tokens: data.tokens,
        mode: data.mode,
        durationMs: data.durationMs,
        selectedCount: data.selectedIds?.length,
      });
      break;
    case "skip":
      memLog("info", "injection", `Skipped: ${data.reason}`, {
        reason: data.reason,
        query: data.query?.slice(0, 100),
      });
      break;
  }
}

export function memLogToolCall(
  tool: string,
  data: {
    success?: boolean;
    durationMs?: number;
    error?: string;
  }
): void {
  memLog("debug", "tool", `Tool call: ${tool}`, {
    success: data.success,
    durationMs: data.durationMs,
    error: data.error,
  });
}

export function memLogSession(
  action: "created" | "idle" | "error",
  data: { sessionId: string; error?: string }
): void {
  const level: LogLevel = action === "error" ? "warn" : "info";
  memLog(level, "session", `Session ${action}`, {
    sessionId: data.sessionId,
    error: data.error,
  });
}

export function memLogAutoCompress(
  action: "triggered" | "skipped" | "complete" | "failed",
  data: {
    reason?: string;
    nodesCompressed?: number;
    tokensSaved?: number;
    durationMs?: number;
    error?: string;
  }
): void {
  switch (action) {
    case "triggered":
      memLog("info", "compress", "Auto-compress triggered", data);
      break;
    case "skipped":
      memLog("debug", "compress", "Auto-compress skipped", data);
      break;
    case "complete":
      memLog("info", "compress", "Auto-compress complete", data);
      break;
    case "failed":
      memLog("error", "compress", "Auto-compress failed", { error: data.error });
      break;
  }
}

export function memLogAgentTool(
  tool: string,
  data: {
    sessionId?: string;
    args?: Record<string, unknown>;
    success?: boolean;
    outputLength?: number;
    durationMs?: number;
  }
): void {
  // Only log tools that matter (not debug/internal)
  const importantTools = ["read", "edit", "write", "bash", "grep", "glob", "task", "memory_search", "memory_set", "memory_get", "memory_list"];
  const isImportant = importantTools.includes(tool) || tool.startsWith("memory_");

  if (isImportant) {
    const durationStr = data.durationMs ? ` (${data.durationMs}ms)` : "";
    const successStr = data.success === false ? " FAILED" : "";
    const lengthStr = data.outputLength ? ` [${data.outputLength} chars]` : "";

    memLog("info", "agent_tool", `${tool}${successStr}${lengthStr}${durationStr}`, {
      sessionId: data.sessionId?.slice(0, 8),
      success: data.success,
      outputLength: data.outputLength,
      durationMs: data.durationMs,
    });
  }
}

export function writeContextDump(systemBlocks: string[]): void {
  try {
    const ts = new Date().toISOString();
    const header = `\n\n========== CONTEXT DUMP: ${ts} ==========\n\n`;
    const content = header + systemBlocks.map((s, i) => `--- BLOCK ${i} ---\n${s}\n`).join("\n");
    fs.appendFileSync(CONTEXT_DUMP_FILE, content);
  } catch { /* silent fail */ }
}
