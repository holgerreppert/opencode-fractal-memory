import type { MemoryNode } from "../../../storage/types";
import { rerankKeyword } from "./keyword";
import { rerankCrossEncoder } from "./cross-encoder";

export type RerankMode = "keyword" | "cross-encoder" | "off";

export interface RerankInput {
  mode: RerankMode;
  query: string;
  candidates: MemoryNode[];
  topK: number;
}

/**
 * Pluggable rerank registry. `off` / too-few-candidates pass through the
 * pipeline order unchanged. `keyword` is a cheap deterministic heuristic;
 * `cross-encoder` runs the local ONNX model for precision (slow, async).
 */
export async function rerank(input: RerankInput): Promise<MemoryNode[]> {
  const { mode, query, candidates, topK } = input;
  if (mode === "off" || candidates.length <= topK) return candidates;

  if (mode === "cross-encoder") {
    return rerankCrossEncoder(query, candidates, topK);
  }
  return rerankKeyword(query, candidates, topK).map(r => ({ ...r.node, importance: r.finalScore }));
}

export { rerankKeyword, rerankCrossEncoder };
