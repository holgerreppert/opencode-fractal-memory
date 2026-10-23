import type { ModelRef, SessionApi } from "../plugin/session-api";

const REWRITE_PROMPT = `You are a memory retrieval query rewriter.
Given the original search query and the user's reasoning context, rewrite the query to improve memory retrieval results.
The original query failed to find highly relevant results — the top results had low confidence or were too similar to each other.

Rules:
- Output ONLY the rewritten query, no explanations, no quotes
- Keep it concise (5-15 words)
- Use different keywords or phrasing than the original
- If the original was too specific, make it more general
- If the original was too vague, add a specific keyword from the reasoning context
- Target different memory node types than the first attempt`;

export interface RewriteInput {
  originalQuery: string;
  reasoningContext: string;
  topLabels: string[];
  topScores: number[];
}

export async function rewriteQuery(
  session: SessionApi,
  model: ModelRef | undefined,
  input: RewriteInput,
): Promise<string | null> {
  const parts = [
    `Original query: "${input.originalQuery}"`,
    `Reasoning context: ${input.reasoningContext.slice(0, 300)}`,
    `Top results had labels: ${input.topLabels.join(", ")}`,
    `Top scores: ${input.topScores.map(s => (s * 100).toFixed(0) + "%").join(", ")}`,
  ];

  if (!model) return null;
  try {
    const text = await session.generate({ model, prompt: `${REWRITE_PROMPT}\n\n${parts.join("\n")}` });
    if (!text) return null;
    const parsed = parseRewrite(text);
    return parsed;
  } catch {
    return null;
  }
}

/** Extract the rewritten query from the model's answer. */
function parseRewrite(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/"([^"]{3,200})"/);
  if (match?.[1]) return match[1];
  const line = trimmed.split("\n").find((l) => l.trim().length > 0);
  return line ? line.trim() : null;
}
