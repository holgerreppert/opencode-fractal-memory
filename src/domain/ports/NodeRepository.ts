import type {
  MemoryScope, MemoryNodeLevel, MemoryNode,
  MemoryCategory, CreateNodeInput, FractalStats, FractalRetrievalResult,
  TemporalEdge,
} from "./MemoryStore";

export interface NodeRepository {
  readonly projectName: string;
  ensureSeed(): Promise<void>;
  listNodes(scope: MemoryScope | "all", level?: MemoryNodeLevel, limit?: number, offset?: number, includeExpired?: boolean, projectName?: string, category?: MemoryCategory): Promise<MemoryNode[]>;
  listProjects(scope: MemoryScope): Promise<string[]>;
  getNode(id: string): Promise<MemoryNode>;
  getNodeByPrefix(prefix: string): Promise<MemoryNode | null>;
  getNodeByLabel(scope: MemoryScope, label: string, includeExpired?: boolean): Promise<MemoryNode>;
  createNode(node: CreateNodeInput): Promise<MemoryNode>;
  updateNode(id: string, updates: { [K in keyof Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "category" | "supertype" | "tags" | "source" | "metadata" | "embedding" | "embeddingSegments" | "sticky" | "ttlDays" | "confidence" | "verificationCount" | "usefulnessScore" | "timesHelpful">]?: MemoryNode[K] | undefined }): Promise<void>;
  deleteNode(id: string): Promise<void>;
  getFractalStats(scope: MemoryScope | "all", projectName?: string | undefined): Promise<FractalStats>;
  retrieveFractal(id: string, maxDepth?: number): Promise<FractalRetrievalResult>;
  verifyNode(id: string): Promise<MemoryNode>;
  calculateNodeConfidence(node: MemoryNode): number;
  storeLinks(scope: MemoryScope, sourceId: string, content: string): Promise<void>;
  getLinkedNodes(scope: MemoryScope, sourceId: string): Promise<MemoryNode[]>;
  backfillLinks(scope: MemoryScope): Promise<void>;
  updateLinksForNewNode(scope: MemoryScope, label: string, nodeId: string): Promise<void>;
  createTemporalEdge(sourceNodeId: string, targetNodeId: string, edgeType: string, scope?: string, confidence?: number, metadata?: Record<string, unknown> | null): Promise<TemporalEdge>;
  getTemporalEdges(nodeId: string, direction?: "outgoing" | "incoming" | "both", edgeType?: string, scope?: MemoryScope): Promise<TemporalEdge[]>;
  expandWithTemporalContext(nodeIds: string[], maxHops?: number, edgeType?: string): Promise<string[]>;
}
