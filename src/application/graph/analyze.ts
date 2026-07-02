import type { CodeGraph, NodeData } from "./graph";

export interface AnalysisResult {
  godNodes: { node: NodeData; degree: number }[];
  surprisingConnections: {
    source: NodeData;
    target: NodeData;
    relation: string;
    score: number;
  }[];
  suggestedQuestions: string[];
  stats: {
    files: number;
    symbols: number;
    edges: number;
    communities: number;
  };
}

export function analyze(graph: CodeGraph): AnalysisResult {
  const stats = { files: 0, symbols: 0, edges: graph.edgeCount(), communities: 0 };
  const communitySet = new Set<string>();

  graph.graph.forEachNode((_id, attrs) => {
    const n = attrs as unknown as NodeData;
    if (n.type === "file") stats.files++;
    else if (n.type === "symbol") stats.symbols++;
    if (n.community) communitySet.add(n.community);
  });
  stats.communities = communitySet.size;

  const degreeMap: { node: NodeData; degree: number }[] = [];
  graph.graph.forEachNode((id, attrs) => {
    const degree = graph.graph.degree(id);
    degreeMap.push({ node: attrs as unknown as NodeData, degree });
  });
  degreeMap.sort((a, b) => b.degree - a.degree);
  const godNodes = degreeMap.slice(0, 10);

  const surprisingConnections: AnalysisResult["surprisingConnections"] = [];
  graph.graph.forEachEdge((_key, attrs, source, target) => {
    const edgeAttrs = attrs as unknown as { relation: string; confidence: string };
    const srcAttrs = graph.graph.getNodeAttributes(source) as unknown as NodeData;
    const tgtAttrs = graph.graph.getNodeAttributes(target) as unknown as NodeData;
    if (srcAttrs.community && tgtAttrs.community && srcAttrs.community !== tgtAttrs.community) {
      surprisingConnections.push({
        source: srcAttrs,
        target: tgtAttrs,
        relation: edgeAttrs.relation,
        score: 1 + (edgeAttrs.confidence === "EXTRACTED" ? 2 : 0),
      });
    }
  });
  surprisingConnections.sort((a, b) => b.score - a.score);
  const topSurprising = surprisingConnections.slice(0, 15);

  const suggestedQuestions = generateQuestions(graph, godNodes);

  return { godNodes, surprisingConnections: topSurprising, suggestedQuestions, stats };
}

function generateQuestions(
  _graph: CodeGraph,
  godNodes: AnalysisResult["godNodes"],
): string[] {
  const qs: string[] = [];
  if (godNodes.length >= 2) {
    const a = godNodes[0]!;
    const b = godNodes[1]!;
    qs.push(`How does \`${a.node.label}\` relate to \`${b.node.label}\`?`);
  }
  if (godNodes.length >= 1) {
    const a = godNodes[0]!;
    qs.push(`What are all the callers of \`${a.node.label}\`?`);
  }
  if (godNodes.length >= 3) {
    const a = godNodes[0]!;
    const b = godNodes[1]!;
    const c = godNodes[2]!;
    qs.push(`What connects \`${a.node.label}\`, \`${b.node.label}\`, and \`${c.node.label}\`?`);
  }
  qs.push("What are the most-connected modules or functions in this codebase?");
  qs.push("Are there any surprising cross-module dependencies?");
  return qs;
}
