export type ConversationTurn = {
  id?: number;
  sessionId: string;
  timestamp: number;
  turnIndex: number;
  role: "user" | "assistant" | "reasoning" | "tool";
  content: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  tokenCount?: number;
  projectName?: string;
  metadata?: string;
};

export type LiveFeedSnapshot = {
  turns: Array<{
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
  }>;
  toolCalls: Array<Record<string, unknown>>;
  compressions: Array<Record<string, unknown>>;
  injections: Array<Record<string, unknown>>;
  session: Record<string, unknown> | null;
};

export interface LiveFeedStore {
  recordConversationTurn(turn: ConversationTurn): Promise<void>;
  getLiveFeedSnapshot(limit?: number): Promise<LiveFeedSnapshot>;
}
