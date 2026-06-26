import type {
  MemoryScope, MemoryNodeLevel, MemoryNode, MemoryNodeType,
  MemoryCategory, CreateNodeInput, FractalStats, FractalRetrievalResult,
  DrilldownResult, TemporalEdge,
} from "./IMemoryStore";

export interface INodeRepository {
  readonly projectName: string;
  ensureSeed(): Promise<void>;
  listNodes(scope: MemoryScope | "all", level?: MemoryNodeLevel, limit?: number, offset?: number, includeExpired?: boolean, projectName?: string, category?: MemoryCategory): Promise<MemoryNode[]>;
  getNode(id: string): Promise<MemoryNode>;
  getNodeByPrefix(prefix: string): Promise<MemoryNode | null>;
  getNodeByLabel(scope: MemoryScope, label: string): Promise<MemoryNode>;
  createNode(node: CreateNodeInput): Promise<MemoryNode>;
  updateNode(id: string, updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "category" | "metadata" | "embedding" | "sticky" | "ttlDays" | "confidence" | "usefulnessScore" | "timesHelpful">>): Promise<void>;
  deleteNode(id: string): Promise<void>;
  searchByEmbedding(query: number[], limit?: number, options?: {
    minLevel?: MemoryNodeLevel; maxLevel?: MemoryNodeLevel;
    levelWeights?: Partial<Record<MemoryNodeLevel, number>>;
    bm25Weight?: number; queryText?: string; minUsefulness?: number;
    bm25Scores?: Map<string, number>; projectName?: string;
    temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number };
    categoryFilter?: MemoryCategory; typeFilter?: MemoryNodeType;
  }): Promise<MemoryNode[]>;
  getFractalStats(scope: MemoryScope | "all", projectName?: string): Promise<FractalStats>;
  retrieveFractal(id: string, maxDepth?: number): Promise<FractalRetrievalResult>;
  detectTopicBoundaries(scope: MemoryScope | "all", minSimilarity?: number, projectName?: string): Promise<MemoryNode[][]>;
  drilldownQuery(query: string, maxResults?: number, projectName?: string): Promise<DrilldownResult[]>;
  verifyNode(id: string): Promise<MemoryNode>;
  calculateNodeConfidence(node: MemoryNode): number;
  storeLinks(scope: MemoryScope, sourceId: string, content: string): Promise<void>;
  getLinkedNodes(scope: MemoryScope, sourceId: string): Promise<MemoryNode[]>;
  backfillLinks(scope: MemoryScope): Promise<void>;
  updateLinksForNewNode(scope: MemoryScope, label: string, nodeId: string): Promise<void>;
  createTemporalEdge(sourceNodeId: string, targetNodeId: string, edgeType: string, scope?: string, confidence?: number, metadata?: Record<string, unknown> | null): Promise<TemporalEdge>;
  getTemporalEdges(nodeId: string, direction?: "outgoing" | "incoming" | "both", edgeType?: string, scope?: MemoryScope): Promise<TemporalEdge[]>;
  expandWithTemporalContext(nodeIds: string[], maxHops?: number, edgeType?: string): Promise<string[]>;
  searchText(scope: MemoryScope | "all", query: string, limit?: number, projectName?: string): Promise<MemoryNode[]>;
  searchBM25(scope: MemoryScope | "all", query: string, limit?: number, projectName?: string): Promise<MemoryNode[]>;
}
