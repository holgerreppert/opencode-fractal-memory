import { fallbackScore, llmJudgeScore, type Candidate } from "./scoring";
import type { ModelRef, SessionApi } from "../../plugin/session-api";
import { rerankDocuments } from "../../infrastructure/llm/ollama";
import type { MemConfig } from "../../infrastructure/config/config";

export interface RerankSource {
  id: string;
  label: string;
  content: string;
}

export interface RerankedItem {
  id: string;
  label: string;
  content: string;
  score: number;
  type: string | null;
  level: number;
}

export interface RerankDeps {
  session?: SessionApi | undefined;
  model?: ModelRef | undefined;
  currentSessionId?: { value: string } | undefined;
  ollama: MemConfig["ollama"];
  llmJudgeEnabled: boolean;
  log: (level: "debug" | "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
}

export function rerankStrategyLabel(deps: RerankDeps): string {
  if (deps.ollama?.enabled) return deps.ollama.strategy ?? "ollama";
  if (deps.llmJudgeEnabled && deps.session && deps.model) return "llm_judge";
  return "fallback";
}

export async function rerankCandidates(
  deps: RerankDeps,
  query: string,
  candidates: Candidate[],
): Promise<RerankedItem[]> {
  const ollama = deps.ollama;
  if (ollama?.enabled) {
    deps.log("info", "memory-rerank: Sending to Ollama for reranking", {
      model: ollama.model,
      candidateCount: candidates.length,
      strategy: ollama.strategy ?? "llm",
    });

    const ollamaInput = candidates.map(c => ({ id: c.id, label: c.label, content: c.content }));
    const reranked = await rerankDocuments(query, ollamaInput, {
      baseUrl: ollama.baseUrl,
      model: ollama.model,
      topK: candidates.length,
      strategy: ollama.strategy ?? "llm",
    });

    const idMap = new Map(candidates.map(c => [c.id, c]));
    const idScore = new Map(reranked.results.map(r => [r.id, r.score]));
    const ordered = reranked.results
      .map(r => {
        const c = idMap.get(r.id);
        return c ? { id: c.id, label: c.label, content: c.content, score: idScore.get(r.id) ?? 0, type: c.type ?? null, level: c.level ?? 0 } : null;
      })
      .filter((x): x is RerankedItem => x !== null);

    deps.log("info", "memory-rerank: Ollama reranking complete", {
      originalCount: candidates.length,
      rerankedCount: ordered.length,
    });
    return ordered;
  }

  if (deps.llmJudgeEnabled && deps.session && deps.model) {
    deps.log("info", "memory-rerank: Using LLM judge", {
      candidateCount: candidates.length,
      model: deps.model,
    });
    const scored = await llmJudgeScore(deps.session!, deps.model, query, candidates);
    const cMap = new Map(candidates.map(c => [c.id, c]));
    return scored.map(s => ({ ...s, type: cMap.get(s.id)?.type ?? null, level: cMap.get(s.id)?.level ?? 0 }));
  }

  deps.log("info", "memory-rerank: No LLM judge available, using fallback scoring");
  const scored = fallbackScore(candidates, query);
  const cMap = new Map(candidates.map(c => [c.id, c]));
  return scored.map(s => ({ ...s, type: cMap.get(s.id)?.type ?? null, level: cMap.get(s.id)?.level ?? 0 }));
}

export function toGateInput(items: RerankedItem[], candidateMap: Map<string, Candidate>) {
  return items.map(item => ({
    id: item.id,
    label: item.label,
    content: item.content,
    score: item.score,
    type: candidateMap.get(item.id)?.type,
    level: candidateMap.get(item.id)?.level,
  }));
}
