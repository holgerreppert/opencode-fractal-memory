export interface CompressionStatsResult {
  total: { calls: number; originalChars: number; compressedChars: number; savingsPercent: number };
  byStrategy: Array<{ strategy: string; calls: number; raw: number; comp: number; avgSavings: number }>;
  byCommand: Array<{ command: string; calls: number; raw: number; comp: number }>;
  recent: Array<{
    timestamp: number; command: string; strategy: string;
    originalChars: number; compressedChars: number;
    originalLines: number | null; compressedLines: number | null;
    cmdPreview: string | null; originalPreview: string | null;
    compressedPreview: string | null; durationMs: number | null;
    savingsRatio: number;
  }>;
}

export interface ContextDashboardResult {
  memory: {
    totalNodes: number; totalTokens: number; totalChars: number;
    byLevel: Array<{ level: number; count: number; tokens: number }>;
    byType: Array<{ type: string; count: number; tokens: number }>;
    rules: number;
  };
  compression: { totalCalls: number; originalChars: number; compressedChars: number; savingsPercent: number };
  injections: Array<{
    sessionId: string; timestamp: number; nodeCount: number;
    tokens: number; mode: string; strategy: string | null;
  }>;
  injectionAggregate: {
    total: number;
    topStrategies: Array<{ strategy: string; count: number }>;
    avgTokens: number;
    avgNodes: number;
  };
  overhead: { systemPromptTokens: number; toolDefTokens: number };
}

export type TokenTrackingEntry = {
  id?: number;
  sessionId: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  turnIndex: number;
  agent: string | null;
  model: string | null;
};

export type TokenHistoryResult = {
  totalSessions: number;
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCost: number;
  bySession: Array<{
    sessionId: string;
    turns: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cost: number;
  }>;
  recentTurns: Array<TokenTrackingEntry>;
};

export interface CompressionStore {
  recordCompressionStat(stat: {
    sessionId?: string; command: string; strategy: string;
    originalChars: number; compressedChars: number;
    originalLines?: number; compressedLines?: number;
    cmdPreview?: string; originalPreview?: string;
    compressedPreview?: string; durationMs?: number;
  }): Promise<void>;
  getCompressionStats(days?: number, limit?: number): Promise<CompressionStatsResult>;
  getContextDashboard(): Promise<ContextDashboardResult>;
  recordTokenUsage(entry: TokenTrackingEntry): Promise<void>;
  getTokenHistory(days?: number, limit?: number): Promise<TokenHistoryResult>;
}
