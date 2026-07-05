export interface InjectionStore {
  logInjectionMetrics(sessionId: string, data: {
    injectedNodeCount: number; injectedTokens: number; injectionMode: string;
    queryText?: string; preRerankIds?: string[]; postRerankIds?: string[];
    rerankScores?: number[]; rerankStrategy?: string; rerankDurationMs?: number;
    injectedNodeTypes?: Record<string, number>;
    activeTypeBoosts?: Record<string, number>;
  }): Promise<void>;
  finalizeInjection(sessionId: string, effectivenessScore?: number, taskDescription?: string): Promise<void>;
  recordInjectionFeedback(sessionId: string, upvotes: number, downvotes: number, taskOutcome?: string, neededNodes?: string[]): Promise<void>;
  getInjectionMetrics(limit?: number): Promise<Array<{
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
  }>>;
  getPendingInjections(): Promise<Array<{ id: number; nodeId: string; scope: string; source: string; createdAt: string }>>;
  markInjectionProcessed(id: number): Promise<void>;
  migrateFromProjectDb(): Promise<number>;
  injectNode(nodeId: string, scope: string): Promise<void>;
}
