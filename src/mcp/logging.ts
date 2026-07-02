import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MCP_LOG_DIR = path.join(os.homedir(), ".config", "opencode", "logs");
const MCP_LOG_FILE = path.join(MCP_LOG_DIR, "mcp-server.log");
const MAX_LOG_SIZE = 1024 * 1024;

if (!fs.existsSync(MCP_LOG_DIR)) {
  fs.mkdirSync(MCP_LOG_DIR, { recursive: true });
}

function mcpFallbackLog(e: unknown, context: string): void {
  process.stderr.write(`[opencode-memory][mcp] ${context}: ${e}\n`);
}

export function mcpLog(level: string, msg: string, data?: Record<string, unknown>): void {
  if (!fs.existsSync(MCP_LOG_DIR)) return;
  try {
    if (fs.existsSync(MCP_LOG_FILE)) {
      try {
        const stat = fs.statSync(MCP_LOG_FILE);
        if (stat.size > MAX_LOG_SIZE) {
          fs.renameSync(MCP_LOG_FILE, MCP_LOG_FILE + ".old");
        }
      } catch (e) {
        mcpFallbackLog(e, "rotate");
      }
    }
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const line = `[${ts}] [${level.padEnd(5)}] [mcp] ${msg}` +
      (data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "");
    fs.appendFileSync(MCP_LOG_FILE, line + "\n");
  } catch (e) {
    mcpFallbackLog(e, "write");
  }
}

export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "content" && typeof v === "string" && v.length > 100) {
      sanitized[k] = v.slice(0, 100) + `... [${v.length} chars]`;
    } else if (k === "query" && typeof v === "string" && v.length > 50) {
      sanitized[k] = v.slice(0, 50) + `... [${v.length} chars]`;
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export function withMcpLogging<T extends Record<string, unknown>>(
  toolName: string,
  handler: (args: T) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>
) {
  return async (args: T) => {
    const start = Date.now();
    mcpLog("info", `call`, { tool: toolName, args: sanitizeArgs(args as Record<string, unknown>) });
    try {
      const result = await handler(args);
      const duration = Date.now() - start;
      const resultSize = JSON.stringify(result).length;
      mcpLog("info", `ok`, { tool: toolName, durationMs: duration, resultChars: resultSize });
      return result;
    } catch (e) {
      const duration = Date.now() - start;
      mcpLog("error", `fail`, { tool: toolName, durationMs: duration, error: e instanceof Error ? e.message : String(e) });
      return {
        content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  };
}
