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
  client: unknown,
  sessionId: string,
  input: RewriteInput,
): Promise<string | null> {
  const parts = [
    `Original query: "${input.originalQuery}"`,
    `Reasoning context: ${input.reasoningContext.slice(0, 300)}`,
    `Top results had labels: ${input.topLabels.join(", ")}`,
    `Top scores: ${input.topScores.map(s => (s * 100).toFixed(0) + "%").join(", ")}`,
  ];

  try {
    const sdkClient = client as {
      session?: {
        prompt?: (opts: {
          messages: Array<{ role: string; content: string }>;
          noReply?: boolean;
        }) => Promise<{ message?: { content?: string } }>;
      };
    };

    const result = await sdkClient.session!.prompt!({
      messages: [
        { role: "system", content: REWRITE_PROMPT },
        { role: "user", content: parts.join("\n") },
      ],
      noReply: true,
    });

    const rewritten = result?.message?.content?.trim() ?? null;
    if (!rewritten || rewritten.length < 3 || rewritten.length > 100) return null;
    return rewritten;
  } catch {
    return null;
  }
}
