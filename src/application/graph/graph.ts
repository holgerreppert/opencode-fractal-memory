import Graph from "graphology";
import { createHash } from "node:crypto";

export interface NodeData {
  id: string;
  label: string;
  type: "file" | "symbol";
  kind?: string;
  file?: string;
  line?: number;
  community?: string;
}

export interface EdgeData {
  source: string;
  target: string;
  relation: string;
  confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
}

export interface GraphJSON {
  nodes: NodeData[];
  edges: EdgeData[];
  fileHashes?: Record<string, string>;
}

export class CodeGraph {
  readonly graph: Graph;
  readonly fileHashes: Record<string, string> = {};
  private _communitiesDetected = false;

  constructor(graph?: Graph) {
    this.graph = graph ?? new Graph({ type: "directed", allowSelfLoops: false });
  }

  hashFile(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  needsRebuild(filePath: string, content: string): boolean {
    const h = this.hashFile(content);
    return this.fileHashes[filePath] !== h;
  }

  markExtracted(filePath: string, content: string): void {
    this.fileHashes[filePath] = this.hashFile(content);
  }

  isNewOrChanged(filePath: string, content: string): boolean {
    return !this.fileHashes[filePath] || this.needsRebuild(filePath, content);
  }

  markCommunitiesDetected(): void {
    this._communitiesDetected = true;
  }

  get communitiesDetected(): boolean {
    return this._communitiesDetected;
  }

  addSymbol(file: string, name: string, kind: string, line: number): string {
    const id = `${file}::${kind}::${name}::${line}`;
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, {
        id,
        label: name,
        type: "symbol",
        kind,
        file,
        line,
      } satisfies NodeData);
    }
    return id;
  }

  addFile(filePath: string): string {
    const id = `file::${filePath}`;
    if (!this.graph.hasNode(id)) {
      const parts = filePath.split("/");
      this.graph.addNode(id, {
        id,
        label: parts[parts.length - 1] ?? filePath,
        type: "file",
        file: filePath,
      } satisfies NodeData);
    }
    return id;
  }

  addEdge(
    source: string,
    target: string,
    relation: string,
    confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS" = "EXTRACTED",
  ): void {
    if (!this.graph.hasNode(source) || !this.graph.hasNode(target)) return;
    const key = `${source}→${relation}→${target}`;
    if (!this.graph.hasEdge(key)) {
      try {
        this.graph.addEdgeWithKey(key, source, target, {
          relation,
          confidence,
        } satisfies Omit<EdgeData, "source" | "target">);
      } catch {
        // parallel edge guard
      }
    }
  }

  addCall(from: string, to: string): void {
    this.addEdge(from, to, "calls");
  }

  addImport(from: string, to: string): void {
    this.addEdge(from, to, "imports");
  }

  addExtends(from: string, to: string): void {
    this.addEdge(from, to, "extends");
  }

  addReferences(from: string, to: string): void {
    this.addEdge(from, to, "references", "INFERRED");
  }

  toJSON(): GraphJSON {
    const nodes: NodeData[] = [];
    this.graph.forEachNode((id, attrs) => {
      nodes.push(attrs as unknown as NodeData);
    });
    const edges: EdgeData[] = [];
    this.graph.forEachEdge((_key, _attrs, source, target, srcAttrs) => {
      const attrs = srcAttrs as unknown as EdgeData;
      edges.push({
        source,
        target,
        relation: attrs.relation,
        confidence: attrs.confidence,
      });
    });
    return { nodes, edges, fileHashes: this.fileHashes };
  }

  static fromJSON(json: GraphJSON): CodeGraph {
    const cg = new CodeGraph();
    for (const n of json.nodes) {
      cg.graph.addNode(n.id, n);
    }
    for (const e of json.edges) {
      cg.addEdge(e.source, e.target, e.relation, e.confidence);
    }
    if (json.fileHashes) {
      Object.assign(cg.fileHashes, json.fileHashes);
    }
    return cg;
  }

  nodeCount(): number {
    return this.graph.order;
  }

  edgeCount(): number {
    return this.graph.size;
  }
}
