import { HNSW } from "hnsw";

const M = 16;
const EF_CONSTRUCTION = 200;
const EF_SEARCH = 64;

export interface HNSWNodeData {
  hnswId: number;
  nodeId: string;
  embedding: number[];
}

export interface HNSWSavedState {
  dimension: number;
  globalIdCounter: number;
  projectIdCounter: number;
  globalNodes: HNSWNodeData[];
  projectNodes: HNSWNodeData[];
}

export class HNSWIndex {
  private globalIndex: HNSW | null = null;
  private projectIndex: HNSW | null = null;
  private globalLabelMap: Map<number, string>;
  private projectLabelMap: Map<number, string>;
  private globalIdCounter: number;
  private projectIdCounter: number;
  private dimension: number;
  private initialized: boolean = false;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
    this.globalLabelMap = new Map();
    this.projectLabelMap = new Map();
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

  async addNode(scope: "global" | "project", nodeId: string, embedding: number[]): Promise<number> {
    if (embedding.length !== this.dimension) {
      return -1;
    }
    
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

  async removeNode(scope: "global" | "project", nodeId: string): Promise<void> {
    const labelMap = this.getMaps(scope);
    for (const [hnswId, storedId] of labelMap) {
      if (storedId === nodeId) {
        labelMap.delete(hnswId);
        return;
      }
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
      
      const combined = [...globalResults, ...projectResults];
      combined.sort((a, b) => b.score - a.score);
      results = combined.slice(0, limit);
    }

    return results
      .map(r => {
        let nodeId: string;
        if (scope === "global") {
          nodeId = this.globalLabelMap.get(r.id) ?? "";
        } else if (scope === "project") {
          nodeId = this.projectLabelMap.get(r.id) ?? "";
        } else {
          nodeId = this.globalLabelMap.get(r.id) ?? this.projectLabelMap.get(r.id) ?? "";
        }
        return { id: nodeId, score: r.score };
      })
      .filter(r => r.id !== "");
  }

  async rebuild(
    nodes: Array<{ id: string; embedding: number[]; scope: "global" | "project" }>
  ): Promise<void> {
    if (nodes.length > 0) {
      this.dimension = nodes[0]!.embedding.length;
    }
    
    this.globalIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
    this.projectIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
    this.globalLabelMap.clear();
    this.projectLabelMap.clear();
    this.globalIdCounter = 0;
    this.projectIdCounter = 0;
    this.initialized = true;

    for (const node of nodes) {
      if (node.embedding.length === this.dimension) {
        await this.addNode(node.scope, node.id, node.embedding);
      }
    }
  }

  getStats(): { globalNodes: number; projectNodes: number; dimension: number } {
    return {
      globalNodes: this.globalLabelMap.size,
      projectNodes: this.projectLabelMap.size,
      dimension: this.dimension,
    };
  }
}

let hnswInstance: HNSWIndex | null = null;

export function getHNSWIndex(dimension: number = 384): HNSWIndex {
  if (!hnswInstance) {
    hnswInstance = new HNSWIndex(dimension);
  }
  return hnswInstance;
}



