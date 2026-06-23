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

export function getSessionId(): string | null {
  return currentSessionId;
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

const SESSION_LOG_FILE = path.join(LOG_DIR, "sessionlog.log");
const SESSION_LOG_MAX_SIZE = 1024 * 1024;

export function appendSessionLog(line: string): void {
  try {
    try {
      const stat = fs.statSync(SESSION_LOG_FILE);
      if (stat.size > SESSION_LOG_MAX_SIZE) {
        fs.renameSync(SESSION_LOG_FILE, SESSION_LOG_FILE + ".old");
      }
    } catch {}
    fs.appendFileSync(SESSION_LOG_FILE, line + "\n");
  } catch {}
}

const COMPRESS_LOG_FILE = path.join(LOG_DIR, "compress.log");
const COMPRESS_LOG_MAX_SIZE = 2 * 1024 * 1024;

export function writeCompressLog(fields: Record<string, string | number>): void {
  try {
    try {
      const stat = fs.statSync(COMPRESS_LOG_FILE);
      if (stat.size > COMPRESS_LOG_MAX_SIZE) {
        fs.renameSync(COMPRESS_LOG_FILE, COMPRESS_LOG_FILE + ".old");
      }
    } catch {}
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const session = currentSessionId ? `session=${currentSessionId.slice(0, 8)}` : "";
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
    const line = `[${ts}] | COMPRESS | ${session}${session ? " | " : ""}${parts.join(" | ")}`;
    fs.appendFileSync(COMPRESS_LOG_FILE, line + "\n");
  } catch {}
}

const FILE_SUM_LOG_FILE = path.join(LOG_DIR, "filesum.log");
const FILE_SUM_LOG_MAX_SIZE = 2 * 1024 * 1024;

export function writeFileSumLog(component: "FILE-SUMMARIZE" | "SKELETONIZE" | "RE-READ", fields: Record<string, string | number>): void {
  try {
    try {
      const stat = fs.statSync(FILE_SUM_LOG_FILE);
      if (stat.size > FILE_SUM_LOG_MAX_SIZE) {
        fs.renameSync(FILE_SUM_LOG_FILE, FILE_SUM_LOG_FILE + ".old");
      }
    } catch {}
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const session = currentSessionId ? `session=${currentSessionId.slice(0, 8)}` : "";
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
    const line = `[${ts}] | ${component} | ${session}${session ? " | " : ""}${parts.join(" | ")}`;
    fs.appendFileSync(FILE_SUM_LOG_FILE, line + "\n");
  } catch {}
}



