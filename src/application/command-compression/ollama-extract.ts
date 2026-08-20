import type { OllamaExtractionConfig } from "./config";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

// Deferred-extraction queue: populated by the compress hook when a non-
// compressible output qualifies for Ollama extraction but deferToIdle is on.
// Drained at session.idle (see events.ts) with a long timeout so interactive
// tool.after never blocks on a slow model load.
export interface PendingExtraction {
  sessionId: string;
  output: string;
  command: string;
}

const pendingQueue: PendingExtraction[] = [];
const MAX_QUEUE_DEFAULT = 20;

export function enqueueExtraction(item: PendingExtraction, maxQueueSize?: number): boolean {
  const cap = maxQueueSize ?? MAX_QUEUE_DEFAULT;
  if (pendingQueue.length >= cap) {
    pendingQueue.shift();
  }
  pendingQueue.push(item);
  return true;
}

export function drainPendingExtractions(limit = 10): PendingExtraction[] {
  return pendingQueue.splice(0, limit);
}

export function pendingExtractionCount(): number {
  return pendingQueue.length;
}

// Warm up the extraction model so tensor loading happens once at idle time,
// not on the first real extraction call. Fire-and-forget.
export async function warmupExtractionModel(config: OllamaExtractionConfig): Promise<void> {
  if (!config.enabled) return;
  try {
    await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        options: { num_predict: 1 },
        keep_alive: config.keepAlive ?? "30m",
      }),
      signal: AbortSignal.timeout(Math.max(config.timeoutMs, 30000)),
    });
  } catch {
    // Best-effort warmup — extraction still works on first real call.
  }
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
        keep_alive: config.keepAlive ?? "30m",
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
