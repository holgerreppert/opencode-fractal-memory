export interface ISessionTracker {
  logToolCall(toolName: string, resultTokens: number, contextWarning: boolean, success: boolean, durationMs?: number): Promise<void>;
  getToolPatterns(scope: "all" | "global" | "project"): Promise<Array<{ toolName: string; count: number; avgTokens: number; avgDurationMs: number; warningRate: number; successRate: number }>>;
  getFrequentSequences(scope: "all" | "global" | "project", minCount?: number): Promise<Array<{ prev: string; next: string; count: number }>>;
  pruneUsageLog(maxAgeMs?: number): Promise<number>;
  recordMemoryToolCall(sessionId: string, toolName: string, args?: Record<string, unknown>): Promise<void>;
  recordAgentToolCall(sessionId: string, toolName: string, args: Record<string, unknown> | null, output: string | null, success: boolean | null, durationMs: number | null): Promise<void>;
  createSessionMetrics(sessionId: string, startedAt?: number): Promise<void>;
  updateSessionMetrics(sessionId: string, updates: { totalTokens?: number; successRate?: number; warningRate?: number; avgTokensPerCall?: number; endedAt?: number; status?: string }): Promise<void>;
  incrementSessionToolCall(sessionId: string, toolName: string, success: boolean, filePath?: string | null): Promise<void>;
  getSessionMetrics(sessionId: string): Promise<{
    totalInjections: number;
    totalToolCalls: number;
    memoryToolsUsed: string[];
    avgEffectiveness: number | null;
  } | null>;
  getSessionStats(sessionId: string): Promise<{
    sessionId: string; startedAt: number; endedAt: number | null;
    status: string; totalToolCalls: number; fileReads: number;
    fileEdits: number; bashCommands: number; memoryTools: number;
    failedTools: number; uniqueFilesTouched: string[];
    injectionCount: number; injectedTokens: number;
    toolCalls: Array<{
      toolName: string; timestamp: number; toolCategory: string;
      filePath: string | null; command: string | null;
      success: boolean | null;
    }>;
  } | null>;
}
