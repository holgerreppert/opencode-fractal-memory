import type { Database } from "bun:sqlite";
import type { ISessionTracker } from "../../../domain/ports/ISessionTracker";
import {
  insertToolUsageLog, queryToolPatterns, queryFrequentSequences, deleteUsageLog, getToolCategory,
} from "../../../storage/tool-usage";
import {
  insertAgentToolCall, createSessionMetrics as createSessionMetricsRow, updateSessionMetrics as updateSessionMetricsRow,
  incrementSessionToolCall as incrementSessionToolCallRow, getSessionStats as getSessionStatsForSession,
} from "../../../storage/session-tracking";
import { querySessionMetrics } from "../../../storage/injection-events";
import { updateMemoryToolCall } from "../../../storage/injection-events";

export class SqliteSessionTracker implements ISessionTracker {
  constructor(private getGlobalDb: () => Promise<Database>) {}

  async logToolCall(toolName: string, resultTokens: number, contextWarning: boolean, success: boolean, durationMs: number = 0): Promise<void> {
    const db = await this.getGlobalDb();
    await insertToolUsageLog(db, toolName, resultTokens, contextWarning, success, durationMs);
  }

  async getToolPatterns(_scope: "all" | "global" | "project"): Promise<Array<{ toolName: string; count: number; avgTokens: number; avgDurationMs: number; warningRate: number; successRate: number }>> {
    const db = await this.getGlobalDb();
    return queryToolPatterns(db);
  }

  async getFrequentSequences(_scope: "all" | "global" | "project", minCount: number = 3): Promise<Array<{ prev: string; next: string; count: number }>> {
    const db = await this.getGlobalDb();
    return queryFrequentSequences(db, minCount);
  }

  async pruneUsageLog(maxAgeMs?: number): Promise<number> {
    const db = await this.getGlobalDb();
    return deleteUsageLog(db, maxAgeMs);
  }

  async recordMemoryToolCall(sessionId: string, toolName: string, _args?: Record<string, unknown>): Promise<void> {
    const db = await this.getGlobalDb();
    await updateMemoryToolCall(db, sessionId, toolName);
  }

  async recordAgentToolCall(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown> | null,
    output: string | null,
    success: boolean | null,
    durationMs: number | null
  ): Promise<void> {
    const db = await this.getGlobalDb();
    const category = getToolCategory(toolName);
    await insertAgentToolCall(db, sessionId, toolName, args, output, success, durationMs, category);

    if (sessionId) {
      await this.incrementSessionToolCall(sessionId, toolName, success ?? true, null);
    }
  }

  async createSessionMetrics(sessionId: string, startedAt?: number): Promise<void> {
    const db = await this.getGlobalDb();
    await createSessionMetricsRow(db, sessionId, startedAt);
  }

  async updateSessionMetrics(
    sessionId: string,
    updates: {
      endedAt?: number;
      status?: string;
      totalTokens?: number;
      successRate?: number;
      warningRate?: number;
      avgTokensPerCall?: number;
    }
  ): Promise<void> {
    const db = await this.getGlobalDb();
    await updateSessionMetricsRow(db, sessionId, updates as Parameters<typeof updateSessionMetricsRow>[2]);
  }

  async incrementSessionToolCall(
    sessionId: string,
    toolName: string,
    success: boolean,
    filePath?: string | null
  ): Promise<void> {
    const db = await this.getGlobalDb();
    await incrementSessionToolCallRow(db, sessionId, toolName, success, filePath);
  }

  async getSessionStats(sessionId: string): Promise<{
    sessionId: string;
    startedAt: number;
    endedAt: number | null;
    status: string;
    totalToolCalls: number;
    fileReads: number;
    fileEdits: number;
    bashCommands: number;
    memoryTools: number;
    failedTools: number;
    uniqueFilesTouched: string[];
    injectionCount: number;
    injectedTokens: number;
    toolCalls: Array<{
      toolName: string;
      timestamp: number;
      toolCategory: string;
      filePath: string | null;
      command: string | null;
      success: boolean | null;
    }>;
  } | null> {
    const db = await this.getGlobalDb();
    return getSessionStatsForSession(db, sessionId);
  }

  async getSessionMetrics(sessionId: string): Promise<{
    totalInjections: number;
    totalToolCalls: number;
    memoryToolsUsed: string[];
    avgEffectiveness: number | null;
  } | null> {
    const db = await this.getGlobalDb();
    return querySessionMetrics(db, sessionId);
  }
}
