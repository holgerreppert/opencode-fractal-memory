import { memLog } from "../../logging";
import type { SqueezExtractionConfig } from "./config";

/**
 * Task-conditioned verbatim extraction via Squeez (KRLabsOrg/squeez-2b).
 * Mirrors Squeez CLI: `cat file | squeez "task"` → <relevant_lines>verbatim</relevant_lines>
 * Protocol: POST <baseUrl>/extract { model, query, tool_output } → { relevant_lines: string[] | string }
 * Fails open (returns null) on any error/timeout.
 * When squeezExtraction.deferToIdle=true, sync call is no-op (caller defers to idle queue).
 */
export async function squeezExtract(
  rawOutput: string,
  query: string,
  config: SqueezExtractionConfig | undefined,
): Promise<string | null> {
  if (!config?.enabled) return null;
  if (config.deferToIdle !== false) return null; // deferred path handled elsewhere if needed
  if (rawOutput.length < (config.minOutputChars ?? 2000)) return null;
  if (!query.trim()) return null;

  const url = `${config.baseUrl.replace(/\/$/, "")}/extract`;
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), config.timeoutMs ?? 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, query, tool_output: rawOutput }),
      signal: controller.signal,
    });
    if (!res.ok) {
      memLog("warn", "compress", `squeez http ${res.status}`, { query: query.slice(0, 60) });
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const lines = data["relevant_lines"] ?? data["output"] ?? data["result"];
    if (Array.isArray(lines)) {
      if (lines.length === 0) return ""; // correctly empty — 80% accuracy on 59 negatives [Squeez]
      return lines.join("\n");
    }
    if (typeof lines === "string") return lines;
    // Fallback: extract <relevant_lines>...</relevant_lines> from raw text
    if (typeof data["text"] === "string") {
      const m = (data["text"] as string).match(/<relevant_lines>([\s\S]*?)<\/relevant_lines>/);
      if (m) return m[1]!.trim();
    }
    return null;
  } catch (err) {
    memLog("warn", "compress", `squeez failed ${String(err)}`, { query: query.slice(0, 60) });
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** Sync variant for pipeline — only when deferToIdle===false, uses fetch with timeout via Promise.race (Bun). */
export function squeezExtractSync(
  rawOutput: string,
  query: string,
  config: SqueezExtractionConfig | undefined,
): string | null {
  // Pipeline is sync; Squeez is async-only. Sync path intentionally no-op — real call is async via hook idle queue.
  // Keep for testability: if deferToIdle===false and Bun supports sync fetch, caller should await squeezExtract.
  void rawOutput; void query; void config;
  return null;
}
