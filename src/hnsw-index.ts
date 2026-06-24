import { HNSW } from "hnsw";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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
    for (const [hnswId, storedId] of labelMap) {
      if (storedId === nodeId) {
        labelMap.delete(hnswId);
        deletedSet.add(hnswId);
        if (deletedSet.size > HNSWIndex.MAX_CACHE_SIZE) {
          deletedSet.clear();
        }
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
    nodes: Array<{ id: string; embedding: number[]; scope: "global" | "project" }>
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

  saveState(): HNSWSavedState {
    const globalNodes: HNSWNodeData[] = [];
    for (const [hnswId, nodeId] of this.globalLabelMap) {
      const embedding = this.embeddingCache.get(`global:${nodeId}`) ?? [];
      globalNodes.push({ hnswId, nodeId, embedding });
    }
    const projectNodes: HNSWNodeData[] = [];
    for (const [hnswId, nodeId] of this.projectLabelMap) {
      const embedding = this.embeddingCache.get(`project:${nodeId}`) ?? [];
      projectNodes.push({ hnswId, nodeId, embedding });
    }
    return {
      dimension: this.dimension,
      globalIdCounter: this.globalIdCounter,
      projectIdCounter: this.projectIdCounter,
      globalNodes,
      projectNodes,
    };
  }

  async loadState(state: HNSWSavedState): Promise<void> {
    this.dimension = state.dimension;
    this.globalIdCounter = state.globalIdCounter;
    this.projectIdCounter = state.projectIdCounter;
    this.globalLabelMap.clear();
    this.projectLabelMap.clear();
    this.globalDeletedIds.clear();
    this.projectDeletedIds.clear();
    this.embeddingCache.clear();

    this.globalIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
    this.projectIndex = new HNSW(M, EF_CONSTRUCTION, this.dimension, "cosine", EF_SEARCH);
    this.initialized = true;

    for (const nd of state.globalNodes) {
      this.globalLabelMap.set(nd.hnswId, nd.nodeId);
      this.embeddingCache.set(`global:${nd.nodeId}`, nd.embedding);
      if (nd.embedding.length === this.dimension) {
        await this.globalIndex!.addPoint(nd.hnswId, nd.embedding);
      }
    }
    for (const nd of state.projectNodes) {
      this.projectLabelMap.set(nd.hnswId, nd.nodeId);
      this.embeddingCache.set(`project:${nd.nodeId}`, nd.embedding);
      if (nd.embedding.length === this.dimension) {
        await this.projectIndex!.addPoint(nd.hnswId, nd.embedding);
      }
    }
  }

  private embeddingCache: Map<string, number[]> = new Map();

  async addNode(scope: "global" | "project", nodeId: string, embedding: number[]): Promise<number> {
    const existing = await this._addNode(scope, nodeId, embedding);
    this.embeddingCache.set(`${scope}:${nodeId}`, embedding);
    return existing;
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

const PERSIST_PATH = path.join(os.homedir(), ".config", "opencode", "hnsw-index.json");

export function persistHNSWIndex(): boolean {
  const idx = hnswInstance;
  if (!idx) return false;
  try {
    const state = idx.saveState();
    const dir = path.dirname(PERSIST_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(state);
    fs.writeFileSync(PERSIST_PATH, json, "utf-8");
    return true;
  } catch { return false; }
}

export function loadHNSWIndexFromDisk(dimension: number = 384): HNSWIndex | null {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return null;
    const raw = fs.readFileSync(PERSIST_PATH, "utf-8");
    const state = JSON.parse(raw) as HNSWSavedState;
    const idx = new HNSWIndex(dimension);
    idx.loadState(state);
    hnswInstance = idx;
    return idx;
  } catch {
    try { fs.unlinkSync(PERSIST_PATH); } catch {}
    return null;
  }
}

let hnswInstance: HNSWIndex | null = null;

export function getHNSWIndex(dimension: number = 384): HNSWIndex {
  if (!hnswInstance) {
    hnswInstance = new HNSWIndex(dimension);
  }
  return hnswInstance;
}



