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

import type { INodeRepository } from "./INodeRepository";
import type { ISessionTracker } from "./ISessionTracker";
import type { IInjectionStore } from "./IInjectionStore";
import type { ICompressionStore } from "./ICompressionStore";
import type { IMaintenanceStore } from "./IMaintenanceStore";
import type { IConfigStore } from "./IConfigStore";

export interface IMemoryStore extends
  INodeRepository,
  ISessionTracker,
  IInjectionStore,
  ICompressionStore,
  IMaintenanceStore,
  IConfigStore
{}
