export type AnswerResult = {
  prediction: string;
  latencyMs: number;
};

export async function getAnswer(
  question: string,
  evidence: string,
  modelUrl: string,
  modelName: string,
): Promise<AnswerResult> {
  const prompt = `Given this context from past conversations:

${evidence}

Answer this question concisely, using only information from the context.
Question: ${question}

If the context doesn't contain the answer, say "I cannot determine from the given context."`;

  const start = Date.now();
  let prediction: string;

  try {
    const resp = await fetch(modelUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
    });

    if (!resp.ok) {
      prediction = `[HTTP ${resp.status}]`;
    } else {
      const body = await resp.json() as { choices?: { message?: { content?: string } }[]; message?: { content?: string } };
      prediction = body.choices?.[0]?.message?.content ?? body.message?.content ?? "[no content]";
    }
  } catch (err) {
    prediction = `[ERROR: ${err}]`;
  }

  return { prediction, latencyMs: Date.now() - start };
}
