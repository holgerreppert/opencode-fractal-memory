import { estimateTokens } from "../../infrastructure/llm/embeddings";

// Per-message context sizing from SDK part payloads. The transform hook and
// the session-messages tool both need "how much context does this message
// occupy" — text parts, reasoning traces, and especially TOOL OUTPUTS
// (state.output — the 3MB bash dumps that dominate real sessions) and file
// parts (source.text.value). info.tokens on assistant messages only counts
// generated text/reasoning, never tool outputs, so part-payload sizing is the
// complete measure.

export type SizablePart = {
  type?: string;
  text?: unknown;
  state?: { output?: unknown; input?: unknown; error?: unknown };
  source?: { text?: { value?: unknown } };
  [key: string]: unknown;
};

export type SizableMessage = {
  info?: { id?: string; role?: string; tokens?: Record<string, unknown>; [key: string]: unknown };
  parts?: SizablePart[];
};

// Raw character length of a part's payload (text/reasoning/tool/file).
export function partPayloadChars(part: SizablePart): number {
  const type = part.type;
  if (type === "text" || type === "reasoning") {
    return typeof part.text === "string" ? part.text.length : 0;
  }
  if (type === "tool") {
    let chars = 0;
    const output = part.state?.output;
    if (typeof output === "string") chars += output.length;
    const input = part.state?.input;
    if (input && typeof input === "object") chars += JSON.stringify(input).length;
    const error = part.state?.error;
    if (typeof error === "string") chars += error.length;
    return chars;
  }
  if (type === "file") {
    const value = part.source?.text?.value;
    return typeof value === "string" ? value.length : 0;
  }
  return 0;
}

// Estimated tokens for a whole message — sum of estimateTokens over every
// part payload. This is the "context cost" the nudge should reason about.
export function estimateMessageTokens(msg: SizableMessage): number {
  if (!msg.parts || msg.parts.length === 0) return 0;
  let total = 0;
  for (const part of msg.parts) {
    const text = partPayloadText(part);
    if (text.length > 0) total += estimateTokens(text);
  }
  return total;
}

// The payload text of a part (for snippets/search).
export function partPayloadText(part: SizablePart): string {
  const type = part.type;
  if (type === "text" || type === "reasoning") {
    return typeof part.text === "string" ? part.text : "";
  }
  if (type === "tool") {
    const parts: string[] = [];
    const output = part.state?.output;
    if (typeof output === "string") parts.push(output);
    const input = part.state?.input;
    if (input && typeof input === "object") parts.push(JSON.stringify(input));
    const error = part.state?.error;
    if (typeof error === "string") parts.push(error);
    return parts.join("\n");
  }
  if (type === "file") {
    const value = part.source?.text?.value;
    return typeof value === "string" ? value : "";
  }
  return "";
}

// Real provider-reported tokens for an assistant message when available
// (info.tokens: {input, output, reasoning, cache}). Returns the generated
// text+reasoning tokens, or null when absent (user messages, old rows).
export function realMessageTokens(msg: SizableMessage): number | null {
  const tokens = msg.info?.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const output = tokens.output;
  const reasoning = tokens.reasoning;
  if (typeof output !== "number" && typeof reasoning !== "number") return null;
  return (typeof output === "number" ? output : 0) + (typeof reasoning === "number" ? reasoning : 0);
}

// Per-part payload char counts grouped by type (for tool output display).
export function partTypeChars(msg: SizableMessage): Record<string, number> {
  const out: Record<string, number> = {};
  if (!msg.parts) return out;
  for (const part of msg.parts) {
    const type = part.type ?? "unknown";
    out[type] = (out[type] ?? 0) + partPayloadChars(part);
  }
  return out;
}