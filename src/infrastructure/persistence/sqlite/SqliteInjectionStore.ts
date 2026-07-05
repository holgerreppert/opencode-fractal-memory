import type { Database } from "bun:sqlite";
import type { InjectionStore } from "../../../domain/ports/InjectionStore";
import {
  insertInjectionMetrics, getPendingInjections as getPendingInjectionRows,
  markInjectionProcessed as markProcessed,
  finalizeInjection as finalizeInjectionRow,
  insertInjectionFeedback, queryInjectionMetrics,
  updateMemoryToolCall,
} from "../../../storage/injection-events";

export class SqliteInjectionStore implements InjectionStore {
  constructor(private getGlobalDb: () => Promise<Database>) {}

  async logInjectionMetrics(
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
    }
  ): Promise<void> {
    const db = await this.getGlobalDb();
    await insertInjectionMetrics(db, sessionId, data);
  }

  async getPendingInjections(): Promise<Array<{ id: number; nodeId: string; scope: string; source: string; createdAt: string }>> {
    const db = await this.getGlobalDb();
    return getPendingInjectionRows(db);
  }

  async markInjectionProcessed(id: number): Promise<void> {
    const db = await this.getGlobalDb();
    markProcessed(db, id);
  }

  async recordMemoryToolCall(sessionId: string, toolName: string, _args?: Record<string, unknown>): Promise<void> {
    const db = await this.getGlobalDb();
    await updateMemoryToolCall(db, sessionId, toolName);
  }

  async finalizeInjection(sessionId: string, effectivenessScore?: number, taskDescription?: string): Promise<void> {
    const db = await this.getGlobalDb();
    await finalizeInjectionRow(db, sessionId, effectivenessScore, taskDescription);
  }

  async recordInjectionFeedback(
    sessionId: string,
    upvotes: number,
    downvotes: number,
    taskOutcome?: string,
    neededNodes?: string[]
  ): Promise<void> {
    const db = await this.getGlobalDb();
    await insertInjectionFeedback(db, sessionId, upvotes, downvotes, taskOutcome, neededNodes);
  }

  async getInjectionMetrics(limit = 100): Promise<Array<{
    sessionId: string; timestamp: number; injectedNodeCount: number;
    injectedTokens: number; injectionMode: string; queryText: string | null;
    preRerankIds: string[] | null; postRerankIds: string[] | null;
    rerankScores: number[] | null; rerankStrategy: string | null;
    rerankDurationMs: number | null;
    injectedNodeTypes: Record<string, number> | null;
    activeTypeBoosts: Record<string, number> | null;
    toolCalls: number; effectivenessScore: number | null;
    injectionUpvotes: number; injectionDownvotes: number;
    taskOutcome: string | null;
  }>> {
    const db = await this.getGlobalDb();
    return queryInjectionMetrics(db, limit);
  }

  async injectNode(nodeId: string, scope: string): Promise<void> {
    const db = await this.getGlobalDb();
    const exists = db.query("SELECT id FROM memory_nodes WHERE id = ?").get(nodeId);
    if (!exists) throw new Error("Node not found");
    db.run("INSERT INTO pending_injections (node_id, scope, source) VALUES (?, ?, 'management')", [nodeId, scope]);
  }

  async migrateFromProjectDb(): Promise<number> {
    return 0; // Handled by SqliteMemoryStore facade
  }
}
