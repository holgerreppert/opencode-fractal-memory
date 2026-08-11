import type { MemoryStore, MemoryScope } from "../../storage/sqlite";
import type { Candidate } from "./scoring";

const MEMORY_SEARCH_HEADER = /^### \[L(\d+)\](?: \[[^\]]+\])?\s+(.+?)\s*-\s*(\d+)%/;

export async function parseCandidates(
  text: string,
  store: MemoryStore,
): Promise<Candidate[]> {
  const labels: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const m = line.match(MEMORY_SEARCH_HEADER);
    if (m) {
      const label = m[2]!.trim();
      if (label) labels.push(label);
    }
  }

  if (labels.length === 0) return [];

  const results: Candidate[] = [];
  const scopes: MemoryScope[] = ["global", "project"];

  for (const label of labels) {
    let found = false;
    for (const scope of scopes) {
      const node = await store.getNodeByLabel(scope, label).catch(() => null);
      if (!node) continue;
      results.push({
        id: node.id,
        label: node.label ?? label,
        content: node.content ?? "",
        importance: node.importance,
        confidence: node.confidence,
        usefulnessScore: node.usefulnessScore,
        accessCount: node.accessCount,
        updatedAt: node.updatedAt,
        type: node.type,
        level: node.level,
      });
      found = true;
      break;
    }
    if (!found) {
      results.push({
        id: label,
        label,
        content: "",
        importance: 0.5,
        confidence: 0.5,
        usefulnessScore: 0.5,
        accessCount: 0,
        updatedAt: null,
      });
    }
  }

  return results;
}
