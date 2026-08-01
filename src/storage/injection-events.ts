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
    preRerankIds?: string[];
    postRerankIds?: string[];
    rerankScores?: number[];
    rerankStrategy?: string;
    rerankDurationMs?: number;
    injectedNodeTypes?: Record<string, number>;
    activeTypeBoosts?: Record<string, number>;
    injectedContent?: Array<{ label: string; type: string; snippet: string }>;
  }
): Promise<void> {
  const id = randomUUID();
  const timestamp = Date.now();

  await withRetry(() => {
    db.run(
      `INSERT INTO injection_metrics 
       (id, session_id, timestamp, injected_node_count, injected_tokens, injection_mode, query_text, tool_calls, memory_tools_used, referenced_nodes,
        pre_rerank_ids, post_rerank_ids, rerank_scores, rerank_strategy, rerank_duration_ms, injected_node_types, active_type_boosts, injected_content)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, '[]', '[]',
        ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, sessionId, timestamp, data.injectedNodeCount, data.injectedTokens, data.injectionMode, data.queryText ?? null,
        data.preRerankIds ? JSON.stringify(data.preRerankIds) : null,
        data.postRerankIds ? JSON.stringify(data.postRerankIds) : null,
        data.rerankScores ? JSON.stringify(data.rerankScores) : null,
        data.rerankStrategy ?? null,
        data.rerankDurationMs ?? null,
        data.injectedNodeTypes ? JSON.stringify(data.injectedNodeTypes) : null,
        data.activeTypeBoosts ? JSON.stringify(data.activeTypeBoosts) : null,
        data.injectedContent ? JSON.stringify(data.injectedContent) : null,
      ]
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

export interface InjectionQualityRow {
  sessionId: string;
  timestamp: number;
  injectedNodeCount: number;
  injectedTokens: number;
  injectionMode: string;
  queryText: string | null;
  preRerankIds: string[] | null;
  postRerankIds: string[] | null;
  rerankScores: number[] | null;
  rerankStrategy: string | null;
  rerankDurationMs: number | null;
  injectedNodeTypes: Record<string, number> | null;
  activeTypeBoosts: Record<string, number> | null;
  injectedContent: Array<{ label: string; type: string; snippet: string }> | null;
  toolCalls: number;
  effectivenessScore: number | null;
  injectionUpvotes: number;
  injectionDownvotes: number;
  taskOutcome: string | null;
}

export function queryInjectionMetrics(
  db: Database,
  limit = 100
): InjectionQualityRow[] {
  const raw = db.query(
    `SELECT session_id, timestamp, injected_node_count, injected_tokens, injection_mode,
            query_text, tool_calls, effectiveness_score,
            injection_upvotes, injection_downvotes, task_outcome,
            pre_rerank_ids, post_rerank_ids, rerank_scores,
            rerank_strategy, rerank_duration_ms, injected_node_types, active_type_boosts,
            injected_content
     FROM injection_metrics 
     ORDER BY timestamp DESC 
     LIMIT ?`
  ).all(limit) as Array<{
    session_id: string;
    timestamp: number;
    injected_node_count: number;
    injected_tokens: number;
    injection_mode: string;
    query_text: string | null;
    tool_calls: number;
    effectiveness_score: number | null;
    injection_upvotes: number | null;
    injection_downvotes: number | null;
    task_outcome: string | null;
    pre_rerank_ids: string | null;
    post_rerank_ids: string | null;
    rerank_scores: string | null;
    rerank_strategy: string | null;
    rerank_duration_ms: number | null;
    injected_node_types: string | null;
    active_type_boosts: string | null;
    injected_content: string | null;
  }>;

  return raw.map(row => {
    const parseJson = <T>(val: string | null): T | null => {
      if (!val) return null;
      try { return JSON.parse(val) as T; } catch { return null; }
    };
    return {
      sessionId: row.session_id,
      timestamp: row.timestamp,
      injectedNodeCount: row.injected_node_count,
      injectedTokens: row.injected_tokens,
      injectionMode: row.injection_mode,
      queryText: row.query_text,
      preRerankIds: parseJson<string[]>(row.pre_rerank_ids),
      postRerankIds: parseJson<string[]>(row.post_rerank_ids),
      rerankScores: parseJson<number[]>(row.rerank_scores),
      rerankStrategy: row.rerank_strategy,
      rerankDurationMs: row.rerank_duration_ms,
      injectedNodeTypes: parseJson<Record<string, number>>(row.injected_node_types),
      activeTypeBoosts: parseJson<Record<string, number>>(row.active_type_boosts),
      injectedContent: parseJson<Array<{ label: string; type: string; snippet: string }>>(row.injected_content),
      toolCalls: row.tool_calls,
      effectivenessScore: row.effectiveness_score,
      injectionUpvotes: row.injection_upvotes ?? 0,
      injectionDownvotes: row.injection_downvotes ?? 0,
      taskOutcome: row.task_outcome,
    };
  });
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
