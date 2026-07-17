import { Database } from "bun:sqlite";

export type ConversationTurnRow = {
  id: number;
  session_id: string;
  timestamp: number;
  turn_index: number;
  role: string;
  content: string;
  tool_name: string | null;
  tool_args: string | null;
  tool_result: string | null;
  token_count: number;
  project_name: string | null;
  metadata: string | null;
};

export function insertConversationTurn(
  db: Database,
  turn: {
    sessionId: string;
    turnIndex: number;
    role: string;
    content: string;
    toolName?: string;
    toolArgs?: string;
    toolResult?: string;
    tokenCount?: number;
    projectName?: string;
    metadata?: string;
  },
): void {
  db.run(
    `INSERT INTO agent_conversation_turns (session_id, timestamp, turn_index, role, content, tool_name, tool_args, tool_result, token_count, project_name, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      turn.sessionId,
      Date.now(),
      turn.turnIndex,
      turn.role,
      turn.content,
      turn.toolName ?? null,
      turn.toolArgs ?? null,
      turn.toolResult ?? null,
      turn.tokenCount ?? 0,
      turn.projectName ?? null,
      turn.metadata ?? null,
    ],
  );
}

export function queryRecentConversationTurns(
  db: Database,
  limit = 50,
  sinceTimestamp = 0,
): ConversationTurnRow[] {
  return db
    .query(
      `SELECT * FROM agent_conversation_turns
       WHERE timestamp > ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(sinceTimestamp, limit) as ConversationTurnRow[];
}

export function queryRecentToolCalls(
  db: Database,
  limit = 20,
  sinceTimestamp = 0,
): Array<{
  id: string;
  session_id: string;
  timestamp: number;
  tool_name: string;
  args_json: string | null;
  output_preview: string | null;
  success: number | null;
  duration_ms: number | null;
  tool_category: string | null;
  file_path: string | null;
  command: string | null;
}> {
  return db
    .query(
      `SELECT * FROM agent_tool_calls
       WHERE timestamp > ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(sinceTimestamp, limit) as any[];
}

export function queryRecentCompressions(
  db: Database,
  limit = 20,
  sinceTimestamp = 0,
): Array<{
  id: number;
  session_id: string | null;
  timestamp: number;
  command: string;
  strategy: string | null;
  original_chars: number;
  compressed_chars: number;
  savings_ratio: number;
  duration_ms: number | null;
  original_lines: number | null;
  compressed_lines: number | null;
  cmd_preview: string | null;
  original_preview: string | null;
  compressed_preview: string | null;
}> {
  return db
    .query(
      `SELECT * FROM compression_stats
       WHERE timestamp > ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(sinceTimestamp, limit) as any[];
}

export function queryRecentInjections(
  db: Database,
  limit = 20,
  sinceTimestamp = 0,
): Array<{
  id: string;
  session_id: string;
  timestamp: number;
  injected_node_count: number;
  injected_tokens: number;
  injection_mode: string | null;
  query_text: string | null;
  tool_calls: number;
  effectiveness_score: number | null;
  rerank_strategy: string | null;
  rerank_scores: string | null;
  rerank_duration_ms: number | null;
  injected_node_types: string | null;
}> {
  return db
    .query(
      `SELECT * FROM injection_metrics
       WHERE timestamp > ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(sinceTimestamp, limit) as any[];
}

export function queryLatestSessionMetrics(
  db: Database,
): {
  session_id: string;
  started_at: number;
  ended_at: number | null;
  status: string | null;
  total_tool_calls: number;
  file_reads: number;
  file_edits: number;
  bash_commands: number;
  memory_tools: number;
  injection_count: number;
  injected_tokens: number;
} | null {
  const row = db
    .query(
      `SELECT * FROM session_metrics
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get() as any;
  return row || null;
}

export function queryLiveFeedSnapshot(
  db: Database,
  limit = 50,
): {
  turns: ConversationTurnRow[];
  toolCalls: any[];
  compressions: any[];
  injections: any[];
  session: any;
} {
  const turnLimit = Math.min(limit, 100);
  return {
    turns: queryRecentConversationTurns(db, turnLimit),
    toolCalls: queryRecentToolCalls(db, 20),
    compressions: queryRecentCompressions(db, 20),
    injections: queryRecentInjections(db, 20),
    session: queryLatestSessionMetrics(db),
  };
}
