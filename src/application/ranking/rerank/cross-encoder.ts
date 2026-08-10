import type { MemoryNode } from "../../../storage/types";
import { rerankDocuments } from "../../../infrastructure/llm/ollama";

/**
 * Cross-encoder rerank via the local ONNX model (ms-marco-MiniLM-L6-v2).
 * Deterministic CPU scoring over a ≥20-candidate pool — the strongest
 * relevance signal (SWE-ContextBench: 18.2% → 56.6% HitRate@5 with gte-small).
 */
export async function rerankCrossEncoder(
  query: string,
  candidates: MemoryNode[],
  topK: number = 10,
): Promise<MemoryNode[]> {
  const pool = candidates.slice(0, Math.max(topK, 20));
  const out = await rerankDocuments(
    query,
    pool.map(n => ({ id: n.id, label: n.label ?? "", content: n.content })),
    { strategy: "cross-encoder", topK },
  );
  const byId = new Map(out.allScores.map(r => [r.id, r.score]));
  return [...pool].sort((a, b) => (byId.get(b.id) ?? 0) - (byId.get(a.id) ?? 0)).slice(0, topK);
}
