import { tokenize } from "../../storage/sqlite";
import { memLog } from "../../logging";
import type { ModelRef, SessionApi } from "../../plugin/session-api";

export interface Candidate {
  id: string;
  label: string;
  content: string;
  importance: number;
  confidence: number;
  usefulnessScore: number;
  accessCount: number;
  updatedAt: Date | null;
  type?: string | null;
  level?: number;
}

/**
 * Heuristic rerank used when the LLM judge / cross-encoder is unavailable.
 * Candidates arrive with `importance` already calibrated by the shared
 * linear-model pipeline (searchByEmbedding → rankCandidates), so this ONLY
 * adds a keyword-overlap signal on top — it must not re-weight importance
 * with stale magic numbers (0.35/0.25/0.15 + access + recency) that double-
 * count signals the pipeline already fused. Final score = 0.7 × pipeline
 * importance + 0.3 × normalized keyword overlap (mirrors rerankKeyword).
 */
export function fallbackScore(
  candidates: Candidate[],
  query: string,
): { id: string; label: string; content: string; score: number }[] {
  const queryTerms = tokenize(query);

  const keywordBoost = new Map<string, number>();
  if (queryTerms.length > 0) {
    for (const c of candidates) {
      const nodeTokens = tokenize(c.content + " " + c.label);
      const overlap = queryTerms.reduce((acc, term) => acc + (nodeTokens.includes(term) ? 1 : 0), 0);
      if (overlap > 0) {
        keywordBoost.set(c.id, Math.min(1, overlap / queryTerms.length));
      }
    }
  }

  const scored = candidates.map(c => ({
    id: c.id,
    label: c.label,
    content: c.content,
    score: 0.7 * (c.importance ?? 0.5) + 0.3 * (keywordBoost.get(c.id) ?? 0),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export async function llmJudgeScore(
  session: SessionApi,
  model: ModelRef | undefined,
  query: string,
  candidates: Candidate[],
): Promise<{ id: string; label: string; content: string; score: number }[]> {
  const candidateLines = candidates.map((c, i) =>
    `[${i}] label: "${c.label}" | content: "${(c.content ?? "").slice(0, 200).replace(/"/g, "'")}"`
  ).join("\n");

  const prompt = `You are scoring memory relevance. The agent is working on:

${query.slice(0, 1000)}

Rate each memory candidate's relevance to the agent's current task. Output a JSON array of objects with "index" (integer from above) and "score" (0.0 to 1.0, 1.0 = most relevant).

Candidates:
${candidateLines}

Output only valid JSON, no other text:`;

  if (!model) {
    memLog("warn", "auto-retrieve", "LLM judge: no model available");
    return fallbackScore(candidates, query);
  }

  try {
    // A one-shot generation: no session, no tools, no reply in the transcript.
    const text = await session.generate({ model, prompt });
    if (!text) {
      memLog("warn", "auto-retrieve", "LLM judge: no result from generation");
      return fallbackScore(candidates, query);
    }
    const parsed = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) {
      memLog("warn", "auto-retrieve", "LLM judge: response not an array");
      return fallbackScore(candidates, query);
    }

    const scores = new Map<number, number>();
    for (const entry of parsed) {
      if (typeof entry.index === "number" && typeof entry.score === "number") {
        scores.set(entry.index, Math.max(0, Math.min(1, entry.score)));
      }
    }

    return candidates.map((c, i) => ({
      id: c.id,
      label: c.label,
      content: c.content,
      score: scores.get(i) ?? 0,
    })).sort((a, b) => b.score - a.score);
  } catch (err) {
    memLog("warn", "auto-retrieve", "LLM judge failed, falling back to heuristic", {
      error: String(err),
    });
    return fallbackScore(candidates, query);
  }
}
