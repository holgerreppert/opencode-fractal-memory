import type { MemoryScope, MemoryNodeLevel, MemoryNode } from "./MemoryStore";

export interface MaintenanceStore {
  runCompression(scope: MemoryScope | "all", force?: boolean, client?: unknown, projectName?: string, sessionId?: string): Promise<{ compressed: number; created: number }>;
  runPatternExtraction(scope: MemoryScope | "all", minSourceCount?: number, projectName?: string): Promise<{ created: number; sources: number }>;
  getCompressionCandidates(scope: MemoryScope | "all", level: MemoryNodeLevel, maxAgeMs?: number, force?: boolean, projectName?: string): Promise<MemoryNode[]>;
  runScoreDecay(decayDays: number): Promise<number>;
  getExpiredNodes(scope?: MemoryScope | "all", projectName?: string): Promise<MemoryNode[]>;
  deleteExpiredNodes(scope?: MemoryScope | "all", projectName?: string): Promise<number>;
  pruneNodes(scope: MemoryScope | "all", options?: {
    minAccessCount?: number | undefined; maxAgeDays?: number | undefined; minImportance?: number | undefined;
    excludeSticky?: boolean | undefined; excludeCore?: boolean | undefined; dryRun?: boolean | undefined;
    projectName?: string | undefined;
  }): Promise<{ prunable: MemoryNode[]; pruned: number }>;
  backfillBinaryEmbeddingsAndBM25(scope: MemoryScope): Promise<void>;
  backfillSupertype(scope: MemoryScope): Promise<void>;
  rebuildHNSWIndex(scope?: MemoryScope | "all"): Promise<void>;
  close(): Promise<void>;
}
