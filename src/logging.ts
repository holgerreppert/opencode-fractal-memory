import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOG_DIR = path.join(os.homedir(), ".config", "opencode", "logs");
const LOG_FILE = path.join(LOG_DIR, "memory-plugin.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export type LogLevel = "debug" | "info" | "warn" | "error";

let currentSessionId: string | null = null;
const logLevel: LogLevel = "info";

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

function fallbackLog(e: unknown, context: string): void {
  process.stderr.write(`[opencode-memory][${context}] ${e}\n`);
}

function localTimestamp(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rotateFile(filePath: string, maxSize: number): void {
  if (!fs.existsSync(filePath)) return;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxSize) {
      fs.renameSync(filePath, filePath + ".old");
    }
  } catch (e) {
    fallbackLog(e, "log-rotate");
  }
}

function writeLog(line: string): void {
  if (!fs.existsSync(LOG_DIR)) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (e) {
      fallbackLog(e, "log-init");
      return;
    }
  }
  try {
    rotateFile(LOG_FILE, MAX_LOG_SIZE);
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (e) {
    fallbackLog(e, "log-write");
  }
}

export function memLog(
  level: LogLevel,
  category: string,
  msg: string,
  data?: Record<string, unknown>
): void {
  if (!shouldLog(level, category)) return;

  const ts = localTimestamp();
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
  if (!fs.existsSync(LOG_DIR)) return;
  try {
    rotateFile(SESSION_LOG_FILE, SESSION_LOG_MAX_SIZE);
    fs.appendFileSync(SESSION_LOG_FILE, line + "\n");
  } catch (e) {
    fallbackLog(e, "session-log");
  }
}

const COMPRESS_LOG_FILE = path.join(LOG_DIR, "compress.log");
const COMPRESS_LOG_MAX_SIZE = 2 * 1024 * 1024;

export function writeCompressLog(fields: Record<string, string | number>): void {
  if (!fs.existsSync(LOG_DIR)) return;
  try {
    rotateFile(COMPRESS_LOG_FILE, COMPRESS_LOG_MAX_SIZE);
    const ts = localTimestamp();
    const session = currentSessionId ? `session=${currentSessionId.slice(0, 8)}` : "";
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
    const line = `[${ts}] | COMPRESS | ${session}${session ? " | " : ""}${parts.join(" | ")}`;
    fs.appendFileSync(COMPRESS_LOG_FILE, line + "\n");
  } catch (e) {
    fallbackLog(e, "compress-log");
  }
}

const FILE_SUM_LOG_FILE = path.join(LOG_DIR, "filesum.log");
const FILE_SUM_LOG_MAX_SIZE = 2 * 1024 * 1024;

const GRAPH_LOG_FILE = path.join(LOG_DIR, "graph.log");
const GRAPH_LOG_MAX_SIZE = 2 * 1024 * 1024;

export function writeGraphLog(level: string, msg: string, data?: Record<string, unknown>): void {
  if (!fs.existsSync(LOG_DIR)) return;
  try {
    rotateFile(GRAPH_LOG_FILE, GRAPH_LOG_MAX_SIZE);
    const ts = localTimestamp();
    const session = currentSessionId ? `[${currentSessionId.slice(0, 8)}]` : "";
    const line = `[${ts}] [${level}]${session} ${msg}` +
      (data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "");
    fs.appendFileSync(GRAPH_LOG_FILE, line + "\n");
  } catch (e) {
    fallbackLog(e, "graph-log");
  }
}

const GRAPH_USAGE_LOG_FILE = path.join(LOG_DIR, "graph-usage.log");
const GRAPH_USAGE_LOG_MAX_SIZE = 2 * 1024 * 1024;

export function writeGraphUsageLog(fields: Record<string, string | number>): void {
  if (!fs.existsSync(LOG_DIR)) return;
  try {
    rotateFile(GRAPH_USAGE_LOG_FILE, GRAPH_USAGE_LOG_MAX_SIZE);
    const ts = localTimestamp();
    const session = currentSessionId ? `session=${currentSessionId.slice(0, 8)}` : "";
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
    const line = `[${ts}] | GRAPH-USAGE | ${session}${session ? " | " : ""}${parts.join(" | ")}`;
    fs.appendFileSync(GRAPH_USAGE_LOG_FILE, line + "\n");
  } catch (e) {
    fallbackLog(e, "graph-usage-log");
  }
}

export function writeFileSumLog(component: "FILE-SUMMARIZE" | "SKELETONIZE" | "RE-READ" | "GRAPH-TOOLS", fields: Record<string, string | number>): void {
  if (!fs.existsSync(LOG_DIR)) return;
  try {
    rotateFile(FILE_SUM_LOG_FILE, FILE_SUM_LOG_MAX_SIZE);
    const ts = localTimestamp();
    const session = currentSessionId ? `session=${currentSessionId.slice(0, 8)}` : "";
    const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
    const line = `[${ts}] | ${component} | ${session}${session ? " | " : ""}${parts.join(" | ")}`;
    fs.appendFileSync(FILE_SUM_LOG_FILE, line + "\n");
  } catch (e) {
    fallbackLog(e, "filesum-log");
  }
}

const LIVE_FEED_LOG_FILE = path.join(LOG_DIR, "live-feed.log");
const LIVE_FEED_LOG_MAX_SIZE = 5 * 1024 * 1024;

export function writeLiveFeedLog(data: Record<string, unknown>): void {
  if (!fs.existsSync(LOG_DIR)) return;
  try {
    rotateFile(LIVE_FEED_LOG_FILE, LIVE_FEED_LOG_MAX_SIZE);
    const ts = localTimestamp();
    const turnCount = (data.turns as any[])?.length ?? 0;
    const injCount = (data.injections as any[])?.length ?? 0;
    const compCount = (data.compressions as any[])?.length ?? 0;
    const toolCount = (data.toolCalls as any[])?.length ?? 0;
    const line = `[${ts}] | turns=${turnCount} injections=${injCount} compressions=${compCount} tools=${toolCount}`;
    fs.appendFileSync(LIVE_FEED_LOG_FILE, line + "\n");
  } catch (e) {
    fallbackLog(e, "live-feed-log");
  }
}
