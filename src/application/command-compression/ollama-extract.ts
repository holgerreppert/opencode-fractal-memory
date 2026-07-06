import type { OllamaExtractionConfig } from "./config";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

/**
 * Send tool output + command to a small Ollama model for relevance extraction.
 * Returns verbatim lines from the output that are relevant to the command.
 * Returns null if extraction fails, times out, or the model returns empty.
 */
export async function ollamaExtract(
  output: string,
  command: string,
  config: OllamaExtractionConfig,
): Promise<string | null> {
  if (!config.enabled) return null;
  if (output.length < config.minOutputChars) return null;

  const lines = output.split("\n");
  if (lines.length < 10) return null;

  const timeoutMs = config.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const query = command.replace(/\s+/g, " ").trim().slice(0, 500);

    const systemPrompt = `You are a tool output pruner. Given a user query and a tool output, return ONLY the exact verbatim lines from the output that are relevant to the query.
Do not summarize, rewrite, or add anything. If no lines are relevant, return an empty response.
Return only the relevant lines, preserving their original content and order.`;

    const userPrompt = `Query: ${query}\n\nTool output:\n${output}`;

    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        temperature: 0.0,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json() as OllamaChatResponse;
    const content = data.message?.content?.trim();
    if (!content || content.length === 0) return null;

    // Verify returned lines exist in original output (verbatim check)
    const returnedLines = content.split("\n").filter(l => l.trim());
    const verbatimLines = returnedLines.filter(rl => {
      const trimmed = rl.trim();
      return trimmed.length > 0 && lines.some(ol => ol.trim() === trimmed);
    });

    if (verbatimLines.length === 0) return null;
    if (verbatimLines.length === lines.length) return null; // no compression

    const result = verbatimLines.join("\n");
    if (result.length >= output.length * 0.95) return null; // insufficient savings

    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
