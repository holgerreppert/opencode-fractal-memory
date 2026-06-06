export type MemoryScope = "global" | "project";

export type MemoryNodeLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type MemoryNodeType = "event" | "episode" | "concept" | "summary" | "core" | "note" | "skill" | "playbook";

export type MemoryNode = {
  id: string;
  scope: MemoryScope;
  label?: string;
  content: string;
  summary: string | null;
  level: MemoryNodeLevel;
  parentIds: string[] | null;
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
  importance: number;
  accessCount: number;
  lastAccessed: Date | null;
  type: MemoryNodeType | null;
  metadata: Record<string, unknown> | null;
  sticky: boolean;
  ttlDays: number | null;
  expiresAt: Date | null;
  confidence: number;
  lastVerified: Date | null;
  usefulnessScore: number;
  timesUsed: number;
  timesHelpful: number;
  projectName: string | null;
};

export type CreateNodeInput = {
  scope: MemoryScope;
  label?: string;
  content: string;
  summary?: string | null;
  level?: MemoryNodeLevel;
  parentIds?: string[] | null;
  embedding?: number[] | null;
  importance?: number;
  type?: MemoryNodeType | null;
  metadata?: Record<string, unknown> | null;
  sticky?: boolean;
  ttlDays?: number | null;
  confidence?: number;
  usefulnessScore?: number;
  timesUsed?: number;
  timesHelpful?: number;
  projectName?: string | null;
};

export type FractalStats = {
  totalNodes: number;
  nodesPerLevel: Record<MemoryNodeLevel, number>;
  compressionRatios: Record<number, number>;
  fractalDimension: number;
  avgChildrenPerNode: number;
  treeDepth: number;
  hasEmbeddings: number;
  scopes: { global: number; project: number };
};

export type FractalRetrievalResult = {
  node: MemoryNode;
  path: MemoryNode[];
  depth: number;
  relevanceScore: number;
};

export type DrilldownResult = {
  node: MemoryNode;
  relevance: number;
  path: MemoryNode[];
  level: "summary" | "intermediate" | "detail";
};

export type MemoryStore = {
  ensureSeed(): Promise<void>;
  listNodes(scope: MemoryScope | "all", level?: MemoryNodeLevel, limit?: number, offset?: number, includeExpired?: boolean): Promise<MemoryNode[]>;
  getNode(id: string): Promise<MemoryNode>;
  getNodeByPrefix(prefix: string): Promise<MemoryNode | null>;
  getNodeByLabel(scope: MemoryScope, label: string): Promise<MemoryNode>;
  createNode(node: CreateNodeInput): Promise<MemoryNode>;
  updateNode(id: string, updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "metadata" | "embedding" | "sticky" | "ttlDays" | "confidence" | "usefulnessScore" | "timesHelpful">>): Promise<void>;
  deleteNode(id: string): Promise<void>;
  searchByEmbedding(query: number[], limit?: number, options?: { minLevel?: MemoryNodeLevel; maxLevel?: MemoryNodeLevel; levelWeights?: Partial<Record<MemoryNodeLevel, number>>; bm25Weight?: number; queryText?: string; minUsefulness?: number; bm25Scores?: Map<string, number> }): Promise<MemoryNode[]>;
  runCompression(scope: MemoryScope | "all", force?: boolean, client?: unknown): Promise<{ compressed: number; created: number }>;
  runPatternExtraction(scope: MemoryScope | "all", minSourceCount?: number): Promise<{ created: number; sources: number }>;
  getCompressionCandidates(scope: MemoryScope | "all", level: MemoryNodeLevel, maxAgeMs?: number, force?: boolean): Promise<MemoryNode[]>;
  getFractalStats(scope: MemoryScope | "all"): Promise<FractalStats>;
  retrieveFractal(id: string, maxDepth?: number): Promise<FractalRetrievalResult>;
  detectTopicBoundaries(scope: MemoryScope | "all", minSimilarity?: number): Promise<MemoryNode[][]>;
  drilldownQuery(query: string, maxResults?: number): Promise<DrilldownResult[]>;
  verifyNode(id: string): Promise<MemoryNode>;
  calculateNodeConfidence(node: MemoryNode): number;
  getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string>;
  setConfig(scope: MemoryScope, key: string, value: string): Promise<void>;
  logToolCall(toolName: string, resultTokens: number, contextWarning: boolean, success: boolean, durationMs?: number): Promise<void>;
  getToolPatterns(scope: MemoryScope | "all"): Promise<Array<{ toolName: string; count: number; avgTokens: number; avgDurationMs: number; warningRate: number; successRate: number }>>;
  getFrequentSequences(scope: MemoryScope | "all", minCount?: number): Promise<Array<{ prev: string; next: string; count: number }>>;
  pruneUsageLog(maxAgeMs?: number): Promise<number>;
  runScoreDecay(decayDays: number): Promise<number>;
  getExpiredNodes(scope?: MemoryScope | "all"): Promise<MemoryNode[]>;
  deleteExpiredNodes(scope?: MemoryScope | "all"): Promise<number>;
  pruneNodes(scope: MemoryScope | "all", options?: {
    minAccessCount?: number;
    maxAgeDays?: number;
    minImportance?: number;
    excludeSticky?: boolean;
    excludeCore?: boolean;
    dryRun?: boolean;
  }): Promise<{ prunable: MemoryNode[]; pruned: number }>;
  storeLinks(scope: MemoryScope, sourceId: string, content: string): Promise<void>;
  getLinkedNodes(scope: MemoryScope, sourceId: string): Promise<MemoryNode[]>;
  backfillLinks(scope: MemoryScope): Promise<void>;
  updateLinksForNewNode(scope: MemoryScope, label: string, nodeId: string): Promise<void>;
  backfillBinaryEmbeddingsAndBM25(scope: MemoryScope): Promise<void>;
  rebuildHNSWIndex(scope?: MemoryScope | "all"): Promise<void>;
  logInjectionMetrics(sessionId: string, data: {
    injectedNodeCount: number;
    injectedTokens: number;
    injectionMode: string;
    queryText?: string;
  }): Promise<void>;
  recordMemoryToolCall(sessionId: string, toolName: string, args?: Record<string, unknown>): Promise<void>;
  finalizeInjection(sessionId: string, effectivenessScore?: number, taskDescription?: string): Promise<void>;
  recordInjectionFeedback(sessionId: string, upvotes: number, downvotes: number, taskOutcome?: string, neededNodes?: string[]): Promise<void>;
  getInjectionMetrics(limit?: number): Promise<Array<{
    sessionId: string;
    timestamp?: number;
    injectedNodeCount: number;
    injectedTokens: number;
    injectionMode: string;
    queryText?: string;
    effectivenessScore?: number | null;
    taskDescription?: string;
    toolCalls?: number;
  }>>;
  getSessionStats(sessionId: string): Promise<{
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
  } | null>;
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
  migrateFromProjectDb(): Promise<number>;
  getPendingInjections(): Promise<Array<{ id: number; nodeId: string; scope: string; source: string; createdAt: string }>>;
  markInjectionProcessed(id: number): Promise<void>;
  close(): Promise<void>;
};

// Phase 2c: Chunking types
export type MemoryChunk = {
  id: string;
  nodeId: string;
  content: string;
  startToken: number;
  endToken: number;
};
