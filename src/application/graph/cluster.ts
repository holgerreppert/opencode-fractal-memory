import louvain from "graphology-communities-louvain";
import type { CodeGraph } from "./graph";

export function detectCommunities(graph: CodeGraph): void {
  if (graph.nodeCount() < 3) return;
  try {
    const g = graph.graph as any;
    const assignment = louvain(g);
    for (const [nodeId, community] of Object.entries(assignment)) {
      g.setNodeAttribute(nodeId, "community", String(community));
    }
  } catch {
    // skip clustering on error (e.g. disconnected graph)
  }
}
