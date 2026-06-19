// Ollama client for chat and reranking
const OLLAMA_BASE = "http://localhost:11434";

import { memLog } from "./logging";
import { scorePairs } from "./cross-encoder";

export type RerankStrategy = "llm" | "cross-encoder";

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  seed?: number;
  strategy?: RerankStrategy;
}

export async function chat(
  messages: Array<{ role: string; content: string }>,
  opts: OllamaOptions = {}
): Promise<string> {
  const baseUrl = opts.baseUrl ?? OLLAMA_BASE;
  const model = opts.model ?? "qwen2.5-coder:1.5b";
  
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: opts.temperature ?? 0.7,
      seed: opts.seed,
    }),
  });
  
  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }
  
  const data = await res.json() as { message?: { content?: string } };
  return data.message?.content ?? "";
}

export interface RerankResult {
  id: string;
  score: number;
}

async function rerankCrossEncoder(
  query: string,
  candidates: Array<{ id: string; label: string; content: string }>,
  opts: { topK: number }
): Promise<RerankResult[]> {
  return await scorePairs(
    query,
    candidates.map(c => ({ id: c.id, content: c.content })),
    opts.topK
  );
}

export async function rerankDocuments(
  query: string,
  candidates: Array<{ id: string; label: string; content: string }>,
  opts: OllamaOptions & { topK?: number } = {}
): Promise<RerankResult[]> {
  const baseUrl = opts.baseUrl ?? OLLAMA_BASE;
  const model = opts.model ?? "qwen2.5-coder:1.5b";
  const topK = opts.topK ?? 5;
  const strategy: RerankStrategy = opts.strategy ?? "llm";

  memLog("debug", "ollama", "[ollama] rerankDocuments called:", { model, baseUrl, strategy, candidateCount: candidates.length, topK });

  if (strategy === "cross-encoder") {
    try {
      return await rerankCrossEncoder(query, candidates, { topK });
    } catch (err) {
      memLog("error", "ollama", "Cross-encoder rerank error:", { error: err instanceof Error ? err.message : err });
      return candidates.slice(0, topK).map(d => ({ id: d.id, score: 0 }));
    }
  }

  const docsList = candidates.map((doc, i) => {
    const content = doc.content.slice(0, 500);
    return `${i + 1}. [${doc.label}]: ${content}`;
  }).join("\n\n");

  const prompt = `You are a relevance judge. Rate each document as 1 (relevant) or 0 (not relevant) for the query.

IMPORTANT: You MUST return EXACTLY ${candidates.length} scores - one per document, in order.
Example for 3 docs: [1, 0, 1]
Your response must be ONLY a JSON array of ${candidates.length} numbers.

Query: ${query}

Documents:
${docsList}

Response (EXACTLY ${candidates.length} scores as JSON array):`;

  try {
    const response = await chat(
      [{ role: "user", content: prompt }],
      { baseUrl, model, temperature: 0.0 }
    );

    const jsonMatch = response.match(/\[.*?\]/s);
    if (!jsonMatch) {
      memLog("error", "ollama", "[ollama] No JSON array found in response:", { response: response.slice(0, 200) });
      return candidates.slice(0, topK).map(d => ({ id: d.id, score: 1 }));
    }

    const scores = JSON.parse(jsonMatch[0]) as number[];
    if (!Array.isArray(scores) || scores.length === 0) {
      memLog("error", "ollama", "[ollama] No valid scores in response:", { response: response.slice(0, 100) });
      return candidates.slice(0, topK).map(d => ({ id: d.id, score: 1 }));
    }

    const normalizedScores = [...scores];
    while (normalizedScores.length < candidates.length) {
      normalizedScores.push(1);
    }
    const finalScores = normalizedScores.slice(0, candidates.length);

    const results: RerankResult[] = candidates.map((d, i) => ({
      id: d.id,
      score: Number(finalScores[i]) === 1 ? 1 : 0,
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  } catch (err) {
    memLog("error", "ollama", "Ollama rerank error:", { error: err instanceof Error ? err.message : err });
    return candidates.slice(0, topK).map(d => ({ id: d.id, score: 1 }));
  }
}