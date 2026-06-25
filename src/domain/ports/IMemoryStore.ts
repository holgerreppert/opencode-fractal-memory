// Domain port — abstraction for memory storage.
// Infrastructure implementations (SqliteMemoryStore, InMemoryMemoryStore) implement this.

export type MemoryScope = "global" | "project";

export type MemoryNodeLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type MemoryNodeType = "event" | "episode" | "concept" | "summary" | "core" | "note" | "skill" | "playbook" | "fact" | "storedcontext";

export type MemoryCategory = "episodic" | "semantic";

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
  category: MemoryCategory | null;
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
  category?: MemoryCategory | null;
  metadata?: Record<string, unknown> | null;
  sticky?: boolean;
  ttlDays?: number | null;
  confidence?: number;
  usefulnessScore?: number;
  timesUsed?: number;
  timesHelpful?: number;
  projectName?: string | null;
};

export type TemporalEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  scope: string;
  createdAt: number;
  confidence: number;
  metadata: Record<string, unknown> | null;
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

export type MemoryChunk = {
  id: string;
  nodeId: string;
  content: string;
  startToken: number;
  endToken: number;
};

export interface IMemoryStore {
  readonly projectName: string;
  ensureSeed(): Promise<void>;
  listNodes(scope: MemoryScope | "all", level?: MemoryNodeLevel, limit?: number, offset?: number, includeExpired?: boolean, projectName?: string, category?: MemoryCategory): Promise<MemoryNode[]>;
  getNode(id: string): Promise<MemoryNode>;
  getNodeByPrefix(prefix: string): Promise<MemoryNode | null>;
  getNodeByLabel(scope: MemoryScope, label: string): Promise<MemoryNode>;
  createNode(node: CreateNodeInput): Promise<MemoryNode>;
  updateNode(id: string, updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "category" | "metadata" | "embedding" | "sticky" | "ttlDays" | "confidence" | "usefulnessScore" | "timesHelpful">>): Promise<void>;
  deleteNode(id: string): Promise<void>;
  searchByEmbedding(query: number[], limit?: number, options?: { minLevel?: MemoryNodeLevel; maxLevel?: MemoryNodeLevel; levelWeights?: Partial<Record<MemoryNodeLevel, number>>; bm25Weight?: number; queryText?: string; minUsefulness?: number; bm25Scores?: Map<string, number>; projectName?: string; temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number }; categoryFilter?: MemoryCategory; typeFilter?: MemoryNodeType }): Promise<MemoryNode[]>;
  runCompression(scope: MemoryScope | "all", force?: boolean, client?: unknown, projectName?: string): Promise<{ compressed: number; created: number }>;
  runPatternExtraction(scope: MemoryScope | "all", minSourceCount?: number, projectName?: string): Promise<{ created: number; sources: number }>;
  getCompressionCandidates(scope: MemoryScope | "all", level: MemoryNodeLevel, maxAgeMs?: number, force?: boolean, projectName?: string): Promise<MemoryNode[]>;
  getFractalStats(scope: MemoryScope | "all", projectName?: string): Promise<FractalStats>;
  retrieveFractal(id: string, maxDepth?: number): Promise<FractalRetrievalResult>;
  detectTopicBoundaries(scope: MemoryScope | "all", minSimilarity?: number, projectName?: string): Promise<MemoryNode[][]>;
  drilldownQuery(query: string, maxResults?: number, projectName?: string): Promise<DrilldownResult[]>;
  verifyNode(id: string): Promise<MemoryNode>;
  calculateNodeConfidence(node: MemoryNode): number;
  getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string>;
  setConfig(scope: MemoryScope, key: string, value: string): Promise<void>;
  logToolCall(toolName: string, resultTokens: number, contextWarning: boolean, success: boolean, durationMs?: number): Promise<void>;
  getToolPatterns(scope: MemoryScope | "all"): Promise<Array<{ toolName: string; count: number; avgTokens: number; avgDurationMs: number; warningRate: number; successRate: number }>>;
  getFrequentSequences(scope: MemoryScope | "all", minCount?: number): Promise<Array<{ prev: string; next: string; count: number }>>;
  pruneUsageLog(maxAgeMs?: number): Promise<number>;
  runScoreDecay(decayDays: number): Promise<number>;
  getExpiredNodes(scope?: MemoryScope | "all", projectName?: string): Promise<MemoryNode[]>;
  deleteExpiredNodes(scope?: MemoryScope | "all", projectName?: string): Promise<number>;
  pruneNodes(scope: MemoryScope | "all", options?: {
    minAccessCount?: number;
    maxAgeDays?: number;
    minImportance?: number;
    excludeSticky?: boolean;
    excludeCore?: boolean;
    dryRun?: boolean;
    projectName?: string;
  }): Promise<{ prunable: MemoryNode[]; pruned: number }>;
  storeLinks(scope: MemoryScope, sourceId: string, content: string): Promise<void>;
  getLinkedNodes(scope: MemoryScope, sourceId: string): Promise<MemoryNode[]>;
  backfillLinks(scope: MemoryScope): Promise<void>;
  updateLinksForNewNode(scope: MemoryScope, label: string, nodeId: string): Promise<void>;
  createTemporalEdge(sourceNodeId: string, targetNodeId: string, edgeType: string, scope?: string, confidence?: number, metadata?: Record<string, unknown> | null): Promise<TemporalEdge>;
  getTemporalEdges(nodeId: string, direction?: "outgoing" | "incoming" | "both", edgeType?: string): Promise<TemporalEdge[]>;
  expandWithTemporalContext(nodeIds: string[], maxHops?: number, edgeType?: string): Promise<string[]>;
  backfillBinaryEmbeddingsAndBM25(scope: MemoryScope): Promise<void>;
  rebuildHNSWIndex(scope?: MemoryScope | "all"): Promise<void>;
  logInjectionMetrics(sessionId: string, data: {
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
  }): Promise<void>;
  recordMemoryToolCall(sessionId: string, toolName: string, args?: Record<string, unknown>): Promise<void>;
  recordCompressionStat(stat: {
    sessionId?: string;
    command: string;
    strategy: string;
    originalChars: number;
    compressedChars: number;
    originalLines?: number;
    compressedLines?: number;
    cmdPreview?: string;
    originalPreview?: string;
    compressedPreview?: string;
    durationMs?: number;
  }): Promise<void>;
  finalizeInjection(sessionId: string, effectivenessScore?: number, taskDescription?: string): Promise<void>;
  recordInjectionFeedback(sessionId: string, upvotes: number, downvotes: number, taskOutcome?: string, neededNodes?: string[]): Promise<void>;
  getInjectionMetrics(limit?: number): Promise<Array<{
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
    toolCalls: number;
    effectivenessScore: number | null;
    injectionUpvotes: number;
    injectionDownvotes: number;
    taskOutcome: string | null;
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
}
