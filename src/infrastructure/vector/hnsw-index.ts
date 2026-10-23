import { HNSW } from "hnsw";

const M = 16;
const EF_CONSTRUCTION = 200;
const EF_SEARCH = 64;

export class HNSWIndex {
  private globalIndex: HNSW | null = null;
  private projectIndex: HNSW | null = null;
  private globalLabelMap: Map<number, string>;
  private projectLabelMap: Map<number, string>;
  private globalIdCounter: number;
  private projectIdCounter: number;
  private dimension: number;
  private initialized: boolean = false;
  private globalDeletedIds: Set<number>;
  private projectDeletedIds: Set<number>;
  private static MAX_CACHE_SIZE = 10000;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
    this.globalLabelMap = new Map();
    this.projectLabelMap = new Map();
    this.globalDeletedIds = new Set();
    this.projectDeletedIds = new Set();
    this.globalIdCounter = 0;
    this.projectIdCounter = 0;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.globalIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
      this.projectIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
      this.initialized = true;
    }
  }

  private getIndex(scope: "global" | "project"): HNSW {
    this.ensureInitialized();
    return scope === "global" ? this.globalIndex! : this.projectIndex!;
  }

  private getMaps(scope: "global" | "project"): Map<number, string> {
    return scope === "global" ? this.globalLabelMap : this.projectLabelMap;
  }

  private getCounter(scope: "global" | "project"): { value: number } {
    return scope === "global" 
      ? { value: this.globalIdCounter } 
      : { value: this.projectIdCounter };
  }

  private setCounter(scope: "global" | "project", value: number): void {
    if (scope === "global") {
      this.globalIdCounter = value;
    } else {
      this.projectIdCounter = value;
    }
  }

  async removeNode(scope: "global" | "project", nodeId: string): Promise<void> {
    const labelMap = this.getMaps(scope);
    const deletedSet = scope === "global" ? this.globalDeletedIds : this.projectDeletedIds;
    const toDelete: number[] = [];
    for (const [hnswId, storedId] of labelMap) {
      if (storedId === nodeId) {
        toDelete.push(hnswId);
      }
    }
    for (const hnswId of toDelete) {
      labelMap.delete(hnswId);
      this.embeddingCache.delete(`${scope}:${hnswId}`);
      deletedSet.add(hnswId);
    }
    if (deletedSet.size > HNSWIndex.MAX_CACHE_SIZE) {
      deletedSet.clear();
    }
  }

  async search(
    query: number[],
    limit: number,
    scope?: "global" | "project",
    _levelFilter?: number
  ): Promise<Array<{ id: string; score: number }>> {
    if (!this.initialized || query.length !== this.dimension) {
      return [];
    }

    let results: Array<{ id: number; score: number }>;

    if (scope === "global") {
      results = this.globalIndex!.searchKNN(query, limit);
    } else if (scope === "project") {
      results = this.projectIndex!.searchKNN(query, limit);
    } else {
      const globalResults = this.globalIndex!.searchKNN(query, limit);
      const projectResults = this.projectIndex!.searchKNN(query, limit);

      const globalMapped = globalResults.map(r => ({
        id: this.globalLabelMap.get(r.id) ?? "",
        score: r.score,
      }));
      const projectMapped = projectResults.map(r => ({
        id: this.projectLabelMap.get(r.id) ?? "",
        score: r.score,
      }));

      const combined = [...globalMapped, ...projectMapped];
      combined.sort((a, b) => b.score - a.score);
      return combined.filter(r => r.id !== "").slice(0, limit);
    }

    const deletedSet = scope === "global" ? this.globalDeletedIds : this.projectDeletedIds;
    return results
      .filter(r => !deletedSet.has(r.id))
      .map(r => {
        const nodeId = scope === "global"
          ? this.globalLabelMap.get(r.id) ?? ""
          : this.projectLabelMap.get(r.id) ?? "";
        return { id: nodeId, score: r.score };
      })
      .filter(r => r.id !== "");
  }

  async rebuild(
    nodes: Array<{ id: string; embedding: number[]; scope: "global" | "project"; segments?: number[][] }>
  ): Promise<void> {
    if (nodes.length > 0) {
      this.dimension = nodes[0]!.embedding.length;
    }
    
    this.globalIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
    this.projectIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
    this.globalLabelMap.clear();
    this.projectLabelMap.clear();
    this.globalDeletedIds.clear();
    this.projectDeletedIds.clear();
    this.globalIdCounter = 0;
    this.projectIdCounter = 0;
    this.embeddingCache.clear();
    this.initialized = true;

    const globalNodes = nodes.filter(n => n.scope === "global");
    const projectNodes = nodes.filter(n => n.scope === "project");

    await this.rebuildScope(this.globalIndex, "global", globalNodes);
    await this.rebuildScope(this.projectIndex, "project", projectNodes);
  }

  private async rebuildScope(
    index: HNSW,
    scope: "global" | "project",
    nodes: Array<{ id: string; embedding: number[]; scope: "global" | "project"; segments?: number[][] }>
  ): Promise<void> {
    const labelMap = this.getMaps(scope);
    const counter = this.getCounter(scope);
    const valid: Array<{ id: number; vector: number[] }> = [];

    for (const node of nodes) {
      const vectors = [node.embedding, ...(node.segments ?? [])];
      for (const vector of vectors) {
        if (vector.length !== this.dimension) continue;
        const hnswId = counter.value;
        labelMap.set(hnswId, node.id);
        this.embeddingCache.set(`${scope}:${hnswId}`, vector);
        valid.push({ id: hnswId, vector });
        counter.value = hnswId + 1;
      }
    }
    this.setCounter(scope, counter.value);

    if (valid.length > 0) {
      await index.buildIndex(valid);
    }
  }

  getStats(): { globalNodes: number; projectNodes: number; dimension: number } {
    const distinct = (map: Map<number, string>): number => new Set(map.values()).size;
    return {
      globalNodes: distinct(this.globalLabelMap),
      projectNodes: distinct(this.projectLabelMap),
      dimension: this.dimension,
    };
  }

  private embeddingCache: Map<string, number[]> = new Map();

  async addNode(scope: "global" | "project", nodeId: string, embedding: number[]): Promise<number> {
    const hnswId = await this._addNode(scope, nodeId, embedding);
    if (hnswId >= 0) {
      this.embeddingCache.set(`${scope}:${hnswId}`, embedding);
    }
    return hnswId;
  }

  private async _addNode(scope: "global" | "project", nodeId: string, embedding: number[]): Promise<number> {
    if (embedding.length !== this.dimension) return -1;
    this.ensureInitialized();
    const index = this.getIndex(scope);
    const labelMap = this.getMaps(scope);
    const counter = this.getCounter(scope);
    const hnswId = counter.value;
    labelMap.set(hnswId, nodeId);
    counter.value = hnswId + 1;
    await index.addPoint(hnswId, embedding);
    this.setCounter(scope, counter.value);
    return hnswId;
  }
}

let hnswInstance: HNSWIndex | null = null;

export function getHNSWIndex(dimension: number = 384): HNSWIndex {
  if (!hnswInstance) {
    hnswInstance = new HNSWIndex(dimension);
  }
  return hnswInstance;
}



