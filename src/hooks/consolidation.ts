import type { MemoryNode, MemoryStore } from "../storage/sqlite";
import { memLog } from "../logging";
import { CompressionHelper } from "../storage/compression";
import { generateEmbedding } from "../embeddings";

export interface ConsolidationConfig {
  enabled: boolean;
  similarityThreshold: number;
  maxFactsPerCluster: number;
  minClusterSize: number;
}

const EPISODIC_TYPES = [
  "event", "note", "session", "task", "plan", "exploration",
  "debug-investigation", "improvement", "review",
];

function extractFactsFromCluster(cluster: MemoryNode[], maxFacts: number): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();

  for (const node of cluster) {
    if (facts.length >= maxFacts) break;
    if (!node.content) continue;

    const content = node.content;
    const lines = content.split("\n");

    for (const line of lines) {
      if (facts.length >= maxFacts) break;
      const trimmed = line.replace(/^[-*\s]+/, "").trim();
      if (trimmed.length < 20) continue;

      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        if (
          /(is|was|has|uses|uses|located|stored|created|called|defined|implements|extends|returns|requires|depends|provides|handles|contains|supports)/i.test(trimmed)
        ) {
          facts.push(trimmed);
        }
      }
    }

    if (node.metadata && typeof node.metadata === "object") {
      const meta = node.metadata as Record<string, unknown>;
      for (const [key, val] of Object.entries(meta)) {
        if (facts.length >= maxFacts) break;
        if (key.startsWith("_")) continue;
        if (typeof val === "string" && val.length > 15 && !seen.has(val)) {
          seen.add(val);
          facts.push(`Metadata ${key}: ${val}`);
        }
      }
    }
  }

  return facts;
}

function buildFactLabel(fact: string, cluster: MemoryNode[]): string {
  const sourceLabels = cluster
    .map(n => n.label)
    .filter(Boolean)
    .slice(0, 3)
    .join("-");

  const shortFact = fact
    .replace(/[^\w\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .toLowerCase()
    .replace(/-+/g, "-");

  const label = `fact:${shortFact}`;
  if (label.length > 200) return label.slice(0, 200);
  return label;
}

export async function runConsolidation(
  store: MemoryStore,
  config: ConsolidationConfig,
  sessionId?: string
): Promise<string> {
  if (!config.enabled) {
    return "Consolidation: skipped (disabled in config)";
  }

  const allNodes = await store.listNodes("all", 0);
  const episodicNodes = allNodes.filter((n: MemoryNode) => {
    if (n.sticky) return false;
    if (n.type === "summary") return false;
    if (n.category !== "episodic") return false;

    if (sessionId && n.metadata && typeof n.metadata === "object") {
      const meta = n.metadata as Record<string, unknown>;
      if (meta.sessionId !== sessionId) return false;
    }

    return true;
  });

  if (episodicNodes.length < config.minClusterSize) {
    return `Consolidation: skipped, only ${episodicNodes.length} episodic nodes, need ${config.minClusterSize}`;
  }

  const nodesWithEmbedding = episodicNodes.filter((n: MemoryNode) => n.embedding);
  const clusters = CompressionHelper.findRelatedNodes(nodesWithEmbedding, config.similarityThreshold);

  if (clusters.length === 0) {
    return `Consolidation: no related clusters found among ${episodicNodes.length} nodes`;
  }

  let factCount = 0;
  let clusterCount = 0;

  for (const cluster of clusters) {
    if (cluster.length < config.minClusterSize) continue;

    const facts = extractFactsFromCluster(cluster, config.maxFactsPerCluster);
    if (facts.length === 0) continue;

    for (const fact of facts) {
      const label = buildFactLabel(fact, cluster);
      let factEmbedding: number[] | null = null;
      try {
        factEmbedding = await generateEmbedding(fact);
      } catch {}

      try {
        const parentIds = cluster.map((n: MemoryNode) => n.id);
        await store.createNode({
          scope: "project",
          label,
          content: fact,
          summary: `Fact extracted from ${cluster.length} episodic nodes via consolidation`,
          level: 0,
          parentIds,
          embedding: factEmbedding,
          importance: Math.max(...cluster.map((n: MemoryNode) => n.importance || 0.3)) * 0.85,
          type: "fact",
          metadata: { source: "consolidation", sourceCount: cluster.length, sessionId: sessionId ?? "unknown" },
        });
        factCount++;
      } catch (err) {
        memLog("warn", "consolidation", "Failed to create fact node", { label, error: String(err) });
      }
    }

    clusterCount++;
  }

  if (factCount === 0) {
    return `Consolidation: processed ${clusterCount} clusters but no facts extracted`;
  }

  const nodeIds = episodicNodes.map((n: MemoryNode) => n.id);
  const summary = `Consolidation: extracted ${factCount} facts from ${clusterCount} clusters (${nodeIds.length} source nodes)`;
  memLog("info", "consolidation", summary);
  return summary;
}
