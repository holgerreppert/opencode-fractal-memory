export interface Part {
  type: string;
  text?: string;
  name?: string;
  isError?: boolean;
  input?: Record<string, unknown>;
}

export interface Message {
  info: { role: string; synthetic?: boolean };
  parts: Part[];
}

export type MessagesHook = (input: unknown, output: { messages: Message[] }) => Promise<void>;

export interface MemorySearchResult {
  part: Part;
  msgIdx: number;
  partIdx: number;
}

export function findMemorySearchResult(messages: Message[]): MemorySearchResult | null {
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (!msg?.parts) continue;
    for (let pi = 0; pi < msg.parts.length; pi++) {
      const part = msg.parts[pi];
      if (part && part.type === "tool_result" && part.name === "memory_search") {
        return { part, msgIdx: mi, partIdx: pi };
      }
    }
  }
  return null;
}

export function extractLastAgentQuery(messages: Message[]): string | null {
  for (let i = messages.length - 2; i >= 0; i--) {
    const msg = messages[i];
    if (!msg?.parts) continue;
    for (const part of msg.parts) {
      if (part.type === "tool_use" && part.name === "memory_search" && part.input) {
        const input = part.input as Record<string, unknown>;
        return typeof input.query === "string" ? input.query : null;
      }
    }
  }
  return null;
}

export function extractLastAgentReasoning(messages: Message[]): string {
  for (let i = messages.length - 2; i >= 0; i--) {
    const msg = messages[i];
    if (!msg?.parts || msg.info?.role !== "assistant") continue;
    const texts: string[] = [];
    for (const part of msg.parts) {
      if (part.type === "reasoning" && part.text) {
        texts.push(part.text);
      }
    }
    if (texts.length > 0) return texts.join("\n").trim();
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        texts.push(part.text);
      }
    }
    const combined = texts.join("\n").trim();
    if (combined) return combined;
  }
  return "";
}

export function extractFooterLines(text: string): string[] {
  const footerLines: string[] = [];
  let inFooter = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("Use memory_drilldown(") || line.startsWith("Use memory_temporal_edges(") || line.startsWith("**Self-Reflection**:") || line.startsWith("  `memory_rate")) {
      inFooter = true;
    }
    if (inFooter) {
      footerLines.push(line);
    }
  }
  return footerLines;
}
