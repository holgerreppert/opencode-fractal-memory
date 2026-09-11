import type {
  MemoryScope, MemoryNode, MemoryNodeLevel, MemoryNodeType,
  MemoryCategory, MemoryDomain, DrilldownResult, SearchIntent, MemorySubtask,
} from "./MemoryStore";
import type { RankWeights } from "../../application/ranking/weights";

export interface SearchFilter {
  typeFilter?: MemoryNodeType | undefined;
  tagsFilter?: string[] | undefined;
  categoryFilter?: MemoryCategory | undefined;
  domainFilter?: MemoryDomain | undefined;
  minLevel?: MemoryNodeLevel | undefined;
  maxLevel?: MemoryNodeLevel | undefined;
}

export interface SearchResult {
  node: MemoryNode;
  score: number;
}

export interface BM25SearchOptions extends SearchFilter {
  limit?: number | undefined;
  projectName?: string | undefined;
}

export interface TextSearchOptions extends SearchFilter {
  limit?: number | undefined;
  projectName?: string | undefined;
}

export interface HybridSearchOptions extends SearchFilter {
  limit?: number | undefined;
  projectName?: string | undefined;
  levelWeights?: Partial<Record<MemoryNodeLevel, number>> | undefined;
  queryText?: string | undefined;
  minUsefulness?: number | undefined;
  rrfK?: number | undefined;
  rerank?: boolean | undefined;
  rerankMode?: "keyword" | "cross-encoder" | undefined;
  bm25Scores?: Map<string, number> | undefined;
  temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number } | undefined;
  temporalHops?: number | undefined;
  intent?: SearchIntent | undefined;
  subtask?: MemorySubtask | undefined;
  featureWeights?: Partial<RankWeights> | undefined;
}

export interface SearchStore {
  searchByEmbedding(query: number[], limit?: number | undefined, options?: HybridSearchOptions): Promise<SearchResult[]>;
  detectTopicBoundaries(scope: MemoryScope | "all", minSimilarity?: number, projectName?: string): Promise<MemoryNode[][]>;
  drilldownQuery(query: string, maxResults?: number, projectName?: string): Promise<DrilldownResult[]>;
  searchText(scope: MemoryScope | "all", query: string, options?: TextSearchOptions): Promise<SearchResult[]>;
  searchBM25(scope: MemoryScope | "all", query: string, options?: BM25SearchOptions): Promise<SearchResult[]>;
}
