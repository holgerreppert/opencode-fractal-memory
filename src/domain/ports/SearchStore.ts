import type {
  MemoryScope, MemoryNode, MemoryNodeLevel, MemoryNodeType,
  MemoryCategory, DrilldownResult, SearchIntent,
} from "./MemoryStore";
import type { RankWeights } from "../../application/ranking/weights";

export interface SearchStore {
  searchByEmbedding(query: number[], limit?: number | undefined, options?: {
    minLevel?: MemoryNodeLevel | undefined; maxLevel?: MemoryNodeLevel | undefined;
    levelWeights?: Partial<Record<MemoryNodeLevel, number>> | undefined;
    queryText?: string | undefined; minUsefulness?: number | undefined;
    rrfK?: number | undefined;
    rerank?: boolean | undefined; rerankMode?: "keyword" | "cross-encoder" | undefined;
    bm25Scores?: Map<string, number> | undefined; projectName?: string | undefined;
    temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number } | undefined;
    temporalHops?: number | undefined;
    categoryFilter?: MemoryCategory | undefined; typeFilter?: MemoryNodeType | undefined;
    intent?: SearchIntent | undefined;
    tagsFilter?: string[] | undefined;
    featureWeights?: Partial<RankWeights> | undefined;
  }): Promise<MemoryNode[]>;
  detectTopicBoundaries(scope: MemoryScope | "all", minSimilarity?: number, projectName?: string): Promise<MemoryNode[][]>;
  drilldownQuery(query: string, maxResults?: number, projectName?: string): Promise<DrilldownResult[]>;
  searchText(scope: MemoryScope | "all", query: string, limit?: number, projectName?: string): Promise<MemoryNode[]>;
  searchBM25(scope: MemoryScope | "all", query: string, limit?: number, projectName?: string): Promise<MemoryNode[]>;
}
