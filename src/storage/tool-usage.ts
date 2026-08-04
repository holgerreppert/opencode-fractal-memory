import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { withRetry } from "./utils";

export async function insertToolUsageLog(
  db: Database,
  toolName: string,
  resultTokens: number,
  contextWarning: boolean,
  success: boolean,
  durationMs: number = 0
): Promise<void> {
  await withRetry(() => {
    db.run(
      "INSERT INTO memory_usage_log (id, tool_name, timestamp, result_tokens, context_warning, success, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), toolName, Date.now(), resultTokens, contextWarning ? 1 : 0, success ? 1 : 0, Math.round(durationMs)],
    );
  });
}

export function queryToolPatterns(db: Database): Array<{
  toolName: string;
  count: number;
  avgTokens: number;
  avgDurationMs: number;
  warningRate: number;
  successRate: number;
}> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = db.query(
    "SELECT tool_name, COUNT(*) as count, AVG(result_tokens) as avg_tokens, AVG(duration_ms) as avg_duration, AVG(context_warning) as warning_rate, AVG(success) as success_rate FROM memory_usage_log WHERE timestamp > ? GROUP BY tool_name ORDER BY count DESC"
  ).all(cutoff) as Array<{
    tool_name: string;
    count: number;
    avg_tokens: number;
    avg_duration: number;
    warning_rate: number;
    success_rate: number;
  }>;

  return rows.map(r => ({
    toolName: r.tool_name,
    count: r.count,
    avgTokens: Math.round(r.avg_tokens),
    avgDurationMs: Math.round(r.avg_duration ?? 0),
    warningRate: Math.round(r.warning_rate * 100),
    successRate: Math.round(r.success_rate * 100),
  }));
}

export function queryFrequentSequences(
  db: Database,
  minCount: number = 3
): Array<{ prev: string; next: string; count: number }> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = db.query(
    "SELECT tool_name, timestamp FROM memory_usage_log WHERE timestamp > ? ORDER BY timestamp ASC"
  ).all(cutoff) as Array<{ tool_name: string; timestamp: number }>;

  const pairs = new Map<string, number>();
  for (let i = 0; i < rows.length - 1; i++) {
    const prev = rows[i]!.tool_name;
    const next = rows[i + 1]!.tool_name;
    if (prev === next) continue;
    const key = `${prev}\u2192${next}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }

  const result: Array<{ prev: string; next: string; count: number }> = [];
  for (const [key, count] of pairs) {
    if (count >= minCount) {
      const [prev, next] = key.split("\u2192");
      result.push({ prev: prev!, next: next!, count });
    }
  }
  result.sort((a, b) => b.count - a.count);
  return result.slice(0, 10);
}

export async function deleteUsageLog(db: Database, maxAgeMs?: number): Promise<number> {
  const threshold = maxAgeMs ?? 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - threshold;
  const result = await withRetry(() => db.run("DELETE FROM memory_usage_log WHERE timestamp < ?", [cutoff]));
  return result.changes;
}

export function getToolCategory(toolName: string): string {
  if (toolName.startsWith("memory_") || toolName.startsWith("journal_")) return "memory";
  if (["memory", "context", "learn", "journal", "graph", "skeletonize"].includes(toolName)) return "memory";
  if (["read", "edit", "write", "glob", "grep", "search"].includes(toolName)) return "file";
  if (["bash", "shell"].includes(toolName)) return "shell";
  return "other";
}
