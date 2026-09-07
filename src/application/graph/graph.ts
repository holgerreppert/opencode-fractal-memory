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
    this.graph = graph ?? (new Graph() as unknown as Graph);
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
    const g = this.graph as any;
    if (!g.hasNode(id)) {
      g.addNode(id, {
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
    const g = this.graph as any;
    if (!g.hasNode(id)) {
      const parts = filePath.split("/");
      g.addNode(id, {
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
    const g = this.graph as any;
    if (!g.hasNode(source) || !g.hasNode(target)) return;
    const key = `${source}→${relation}→${target}`;
    if (!g.hasEdge(key)) {
      try {
        g.addEdgeWithKey(key, source, target, {
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
    const g = this.graph as any;
    const nodes: NodeData[] = [];
    g.forEachNode((id: string, attrs: any) => {
      nodes.push(attrs as unknown as NodeData);
    });
    const edges: EdgeData[] = [];
    g.forEachEdge((_key: string, edgeAttrs: any, source: string, target: string) => {
      const attrs = edgeAttrs as unknown as EdgeData;
      edges.push({ source, target, relation: attrs.relation, confidence: attrs.confidence });
    });
    return { nodes, edges, fileHashes: this.fileHashes };
  }

  static fromJSON(json: GraphJSON): CodeGraph {
    const cg = new CodeGraph();
    const g = cg.graph as any;
    for (const n of json.nodes) {
      g.addNode(n.id, n);
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
    return (this.graph as any).order;
  }

  edgeCount(): number {
    return (this.graph as any).size;
  }
}
