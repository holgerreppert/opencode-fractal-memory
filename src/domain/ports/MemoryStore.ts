// Domain port — abstraction for memory storage.
// Infrastructure implementations (SqliteMemoryStore, InMemoryMemoryStore) implement this.

export type MemoryScope = "global" | "project";

export type MemoryNodeLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type MemoryNodeType = "event" | "episode" | "concept" | "summary" | "core" | "note" | "skill" | "playbook" | "fact" | "lesson" | "knowledge" | "storedcontext" | "contexthistory" | "dot";

export type MemoryCategory = "episodic" | "semantic";
export type MemorySupertype = "declarative" | "procedural" | "experiential" | "meta";
export type MemoryDomain = "architecture" | "operations" | "knowledge" | "rules" | "history" | "patterns" | "preferences" | null;
export type SearchIntent = "read" | "edit" | "debug" | "discovery";

export type MemoryNode = {
  id: string;
  scope: MemoryScope;
  label: string | null;
  content: string;
  summary: string | null;
  level: MemoryNodeLevel;
  parentIds: string[] | null;
  embedding: number[] | null;
  embeddingSegments: number[][] | null;
  createdAt: Date;
  updatedAt: Date;
  importance: number;
  accessCount: number;
  lastAccessed: Date | null;
  type: MemoryNodeType | null;
  category: MemoryCategory | null;
  supertype: MemorySupertype | null;
  domain: MemoryDomain;
  metadata: Record<string, unknown> | null;
  sticky: boolean;
  ttlDays: number | null;
  expiresAt: Date | null;
  tags: string[] | null;
  source: string | null;
  confidence: number;
  lastVerified: Date | null;
  verificationCount: number;
  usefulnessScore: number;
  timesUsed: number;
  timesHelpful: number;
  projectName: string | null;
  derivedFrom: string[] | null;
  derivation: string | null;
  status: "active" | "proposed" | "superseded" | null;
  validFrom: Date | null;
  validUntil: Date | null;
  supersedesId: string | null;
  contentHash: string | null;
};

export type CreateNodeInput = {
  scope: MemoryScope;
  label?: string | undefined;
  content: string;
  summary?: string | null | undefined;
  level?: MemoryNodeLevel | undefined;
  parentIds?: string[] | null | undefined;
  embedding?: number[] | null | undefined;
  embeddingSegments?: number[][] | null | undefined;
  importance?: number | undefined;
  type?: MemoryNodeType | null | undefined;
  category?: MemoryCategory | null | undefined;
  supertype?: MemorySupertype | null | undefined;
  domain?: MemoryDomain | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  sticky?: boolean | undefined;
  ttlDays?: number | null | undefined;
  tags?: string[] | null | undefined;
  source?: string | null | undefined;
  confidence?: number | undefined;
  verificationCount?: number | undefined;
  usefulnessScore?: number | undefined;
  timesUsed?: number | undefined;
  timesHelpful?: number | undefined;
  projectName?: string | null | undefined;
  derivedFrom?: string[] | null | undefined;
  derivation?: string | null | undefined;
  status?: "active" | "proposed" | "superseded" | null | undefined;
  validFrom?: Date | null | undefined;
  validUntil?: Date | null | undefined;
  supersedesId?: string | null | undefined;
  contentHash?: string | null | undefined;
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

import type { NodeRepository } from "./NodeRepository";
import type { SessionTracker } from "./SessionTracker";
import type { InjectionStore } from "./InjectionStore";
import type { CompressionStore } from "./CompressionStore";
import type { MaintenanceStore } from "./MaintenanceStore";
import type { ConfigStore } from "./ConfigStore";
import type { LiveFeedStore } from "./LiveFeedStore";
import type { SearchStore } from "./SearchStore";
import type { UnitOfWork } from "./UnitOfWork";

export interface MemoryStore extends
  NodeRepository,
  SessionTracker,
  InjectionStore,
  CompressionStore,
  MaintenanceStore,
  ConfigStore,
  LiveFeedStore,
  SearchStore,
  UnitOfWork
{
  readonly projectName: string;
}
