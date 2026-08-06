import type {
  MemoryCategory,
  MemoryDomain,
  MemoryNode,
  MemoryNodeLevel,
  MemoryNodeType,
  MemoryScope,
  SearchIntent,
} from "../domain/ports/MemoryStore";
import type { MemoryStore } from "../domain/ports/MemoryStore";

/**
 * Unified search mode. `hybrid` (default) fuses semantic + BM25 with RRF.
 * `bm25` and `text` are fast keyword-only paths that never touch the
 * embedding model — useful when embeddings are unavailable or latency matters.
 */
export type SearchMode = "hybrid" | "bm25" | "text";

/**
 * String-first search facade. This is the ONE public search entrypoint for
 * node retrieval across all surfaces (memory tool, MCP, management API,
 * auto-retrieve, seed-rules). It dispatches to the store's underlying
 * retrieval engines and applies the shared RRF/temporal/rerank pipeline.
 *
 * The embedding function is injected (not imported) to keep the application
 * layer free of infrastructure dependencies.
 */
export async function searchNodes(
  store: MemoryStore,
  embed: (text: string) => Promise<number[]>,
  query: string,
  opts: {
    limit?: number | undefined;
    mode?: SearchMode | undefined;
    scope?: MemoryScope | "all" | undefined;
    projectName?: string | undefined;
    minLevel?: MemoryNodeLevel | undefined;
    maxLevel?: MemoryNodeLevel | undefined;
    minUsefulness?: number | undefined;
    rrfK?: number | undefined;
    rerank?: boolean | undefined;
    rerankMode?: "keyword" | "cross-encoder" | undefined;
    temporalHops?: number | undefined;
    intent?: SearchIntent | undefined;
    categoryFilter?: MemoryCategory | undefined;
    domainFilter?: MemoryDomain | undefined;
    typeFilter?: MemoryNodeType | undefined;
    tagsFilter?: string[] | undefined;
  } = {},
): Promise<MemoryNode[]> {
  const limit = opts.limit ?? 10;
  const mode = opts.mode ?? "hybrid";
  const scope = opts.scope ?? "all";
  const projectName = opts.projectName;

  // Fast keyword-only modes never touch the embedding model.
  if (mode === "bm25") return store.searchBM25(scope, query, limit, projectName);
  if (mode === "text") return store.searchText(scope, query, limit, projectName);

  // Hybrid: embed the query ourselves, then run the full fused pipeline.
  // If embedding fails or yields nothing, degrade to BM25 rather than 0 hits.
  let embedding: number[] = [];
  try {
    embedding = await embed(query);
  } catch {
    embedding = [];
  }
  if (!embedding || embedding.length === 0) {
    return store.searchBM25(scope, query, limit, projectName);
  }

  const options: {
    minLevel?: MemoryNodeLevel;
    maxLevel?: MemoryNodeLevel;
    rrfK?: number;
    queryText?: string;
    minUsefulness?: number | undefined;
    rerank?: boolean | undefined;
    rerankMode?: "keyword" | "cross-encoder" | undefined;
    projectName?: string | undefined;
    temporalHops?: number | undefined;
    intent?: SearchIntent | undefined;
    categoryFilter?: MemoryCategory | undefined;
    domainFilter?: MemoryDomain | undefined;
    typeFilter?: MemoryNodeType | undefined;
    tagsFilter?: string[] | undefined;
  } = {
    queryText: query,
    rerank: opts.rerank ?? true,
  };
  if (opts.minLevel !== undefined) options.minLevel = opts.minLevel;
  if (opts.maxLevel !== undefined) options.maxLevel = opts.maxLevel;
  if (opts.minUsefulness !== undefined) options.minUsefulness = opts.minUsefulness;
  if (opts.rrfK !== undefined) options.rrfK = opts.rrfK;
  if (opts.projectName !== undefined) options.projectName = projectName;
  if (opts.temporalHops !== undefined && opts.temporalHops > 0) options.temporalHops = opts.temporalHops;
  if (opts.intent !== undefined) options.intent = opts.intent;
  if (opts.categoryFilter !== undefined) options.categoryFilter = opts.categoryFilter;
  if (opts.domainFilter !== undefined) options.domainFilter = opts.domainFilter;
  if (opts.typeFilter !== undefined) options.typeFilter = opts.typeFilter;
  if (opts.tagsFilter !== undefined) options.tagsFilter = opts.tagsFilter;
  if (opts.rerankMode !== undefined) options.rerankMode = opts.rerankMode;

  return store.searchByEmbedding(embedding, limit, options);
}

export type { MemoryScope, MemoryNode, MemoryNodeType, MemoryCategory, MemoryDomain, SearchIntent, MemoryNodeLevel };