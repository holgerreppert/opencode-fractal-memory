import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { withRetry } from "./utils";

export async function insertInjectionMetrics(
  db: Database,
  sessionId: string,
  data: {
    injectedNodeCount: number;
    injectedTokens: number;
    injectionMode: string;
    queryText?: string;
  }
): Promise<void> {
  const id = randomUUID();
  const timestamp = Date.now();

  await withRetry(() => {
    db.run(
      `INSERT INTO injection_metrics 
       (id, session_id, timestamp, injected_node_count, injected_tokens, injection_mode, query_text, tool_calls, memory_tools_used, referenced_nodes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, '[]', '[]')`,
      [id, sessionId, timestamp, data.injectedNodeCount, data.injectedTokens, data.injectionMode, data.queryText ?? null]
    );
  });
}

export function getPendingInjections(db: Database): Array<{
  id: number;
  nodeId: string;
  scope: string;
  source: string;
  createdAt: string;
}> {
  try {
    return db.query(
      "SELECT id, node_id as nodeId, scope, source, created_at as createdAt FROM pending_injections WHERE processed = 0 ORDER BY id ASC"
    ).all() as Array<{ id: number; nodeId: string; scope: string; source: string; createdAt: string }>;
  } catch {
    return [];
  }
}

export function markInjectionProcessed(db: Database, id: number): void {
  try {
    db.run("UPDATE pending_injections SET processed = 1 WHERE id = ?", [id]);
  } catch {
    // silently ignore
  }
}

export async function updateMemoryToolCall(db: Database, sessionId: string, toolName: string): Promise<void> {
  const metrics = db.query(
    "SELECT id, tool_calls, memory_tools_used FROM injection_metrics WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1"
  ).get(sessionId) as { id: string; tool_calls: number; memory_tools_used: string } | null;

  if (!metrics) return;

  const tools = JSON.parse(metrics.memory_tools_used || '[]') as string[];
  if (!tools.includes(toolName)) {
    tools.push(toolName);
  }

  await withRetry(() => {
    db.run(
      "UPDATE injection_metrics SET tool_calls = ?, memory_tools_used = ? WHERE id = ?",
      [metrics.tool_calls + 1, JSON.stringify(tools), metrics.id]
    );
  });
}

export async function finalizeInjection(
  db: Database,
  sessionId: string,
  effectivenessScore?: number,
  taskDescription?: string
): Promise<void> {
  await withRetry(() => {
    db.run(
      "UPDATE injection_metrics SET effectiveness_score = ?, task_description = ? WHERE session_id = ?",
      [effectivenessScore ?? null, taskDescription ?? null, sessionId]
    );
  });
}

export async function insertInjectionFeedback(
  db: Database,
  sessionId: string,
  upvotes: number,
  downvotes: number,
  taskOutcome?: string,
  neededNodes?: string[]
): Promise<void> {
  await withRetry(() => {
    db.run(
      `UPDATE injection_metrics 
       SET injection_upvotes = ?, injection_downvotes = ?, task_outcome = ?, needed_nodes = ?
       WHERE session_id = ?`,
      [upvotes, downvotes, taskOutcome ?? null, neededNodes ? JSON.stringify(neededNodes) : null, sessionId]
    );
  });
}

export function queryInjectionMetrics(
  db: Database,
  limit = 100
): Array<{
  sessionId: string;
  timestamp: number;
  injectedNodeCount: number;
  injectedTokens: number;
  injectionMode: string;
  toolCalls: number;
  effectivenessScore: number | null;
}> {
  const rows = db.query(
    `SELECT session_id, timestamp, injected_node_count, injected_tokens, injection_mode, tool_calls, effectiveness_score
     FROM injection_metrics 
     ORDER BY timestamp DESC 
     LIMIT ?`
  ).all(limit) as Array<{
    session_id: string;
    timestamp: number;
    injected_node_count: number;
    injected_tokens: number;
    injection_mode: string;
    tool_calls: number;
    effectiveness_score: number | null;
  }>;

  return rows.map(row => ({
    sessionId: row.session_id,
    timestamp: row.timestamp,
    injectedNodeCount: row.injected_node_count,
    injectedTokens: row.injected_tokens,
    injectionMode: row.injection_mode,
    toolCalls: row.tool_calls,
    effectivenessScore: row.effectiveness_score,
  }));
}

export function querySessionMetrics(
  db: Database,
  sessionId: string
): {
  totalInjections: number;
  totalToolCalls: number;
  memoryToolsUsed: string[];
  avgEffectiveness: number | null;
} {
  const row = db.query(
    `SELECT 
       COUNT(*) as total_injections,
       SUM(tool_calls) as total_tool_calls,
       AVG(effectiveness_score) as avg_effectiveness
     FROM injection_metrics 
     WHERE session_id = ?`
  ).get(sessionId) as {
    total_injections: number;
    total_tool_calls: number | null;
    avg_effectiveness: number | null;
  };

  const toolsRow = db.query(
    `SELECT memory_tools_used FROM injection_metrics WHERE session_id = ? LIMIT 1`
  ).get(sessionId) as { memory_tools_used: string } | null;

  const memoryToolsUsed = toolsRow ? JSON.parse(toolsRow.memory_tools_used || '[]') as string[] : [];

  return {
    totalInjections: row.total_injections,
    totalToolCalls: row.total_tool_calls ?? 0,
    memoryToolsUsed,
    avgEffectiveness: row.avg_effectiveness,
  };
}
