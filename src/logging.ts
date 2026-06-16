import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOG_DIR = path.join(os.homedir(), ".config", "opencode", "logs");
const LOG_FILE = path.join(LOG_DIR, "memory-plugin.log");
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

export function perfNow(): number {
  return Date.now();
}



