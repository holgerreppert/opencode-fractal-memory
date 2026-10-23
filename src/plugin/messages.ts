/**
 * Canonical session-message projection.
 *
 * The runtime hands out session messages in its own tagged-union shape
 * (`{type: "user" | "assistant" | ..., content: [...]}`). Everything inside
 * the plugin works with ONE normalized message instead, so tools and hooks do
 * not each re-implement the mapping.
 */

import type { MessagePart } from "./hooks/types";

/** A normalized message part. */
export interface SessionMessagePart extends MessagePart {
  type: string;
  text?: string | undefined;
  name?: string | undefined;
  input?: unknown;
  isError?: boolean | undefined;
}

/** A normalized session message. */
export interface SessionMessage {
  id: string;
  role: string;
  type?: string;
  /** Concatenated text of the message. */
  text: string;
  /** The runtime's token usage for the message, when it reports one. */
  tokens?: unknown;
  cost?: number | undefined;
  model?: string | undefined;
  agent?: string | undefined;
  created?: number | undefined;
  parts: SessionMessagePart[];
}

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | undefined {
  return value && typeof value === "object" ? (value as Raw) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readParts(raw: Raw): SessionMessagePart[] {
  const parts: SessionMessagePart[] = [];

  // Assistant messages carry `content: [{type: "text" | "reasoning" | "tool"}]`.
  const content = Array.isArray(raw["content"]) ? (raw["content"] as unknown[]) : [];
  for (const entry of content) {
    const part = asRecord(entry);
    if (!part) continue;
    const type = asString(part["type"]) ?? "text";
    const text = asString(part["text"]);
    if (type === "tool" || type === "tool-call" || type === "tool-result") {
      parts.push({
        type,
        text,
        name: asString(part["name"]) ?? asString(part["toolName"]),
        input: part["input"] ?? part["args"],
        isError: part["isError"] === true,
      });
      continue;
    }
    parts.push({ type, text });
  }

  // User/system/synthetic messages carry a plain `text` field.
  const text = asString(raw["text"]);
  if (text !== undefined && parts.length === 0) {
    parts.push({ type: "text", text });
  }

  return parts;
}

/**
 * Normalize one runtime message.
 *
 * Unknown message types are kept (role falls back to the type) so a new
 * runtime message kind never silently disappears from the plugin's view.
 */
function projectMessage(raw: unknown): SessionMessage {
  const info = asRecord(raw) ?? {};
  const type = asString(info["type"]) ?? "unknown";
  const parts = readParts(info);
  const tokens = info["tokens"];
  const cost = asNumber(info["cost"]);
  const modelRef = asRecord(info["model"]);
  const time = asRecord(info["time"]);

  return {
    id: asString(info["id"]) ?? "",
    role: type === "tool" ? "tool" : type,
    type,
    text: parts.map((p) => p.text ?? "").join(""),
    tokens,
    cost,
    model: modelRef ? `${asString(modelRef["providerID"]) ?? ""}/${asString(modelRef["id"]) ?? ""}` : undefined,
    agent: asString(info["agent"]),
    created: time ? asNumber(time["created"]) : undefined,
    parts,
  };
}

/** Normalize a list of runtime messages. */
export function projectMessages(raw: unknown): SessionMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(projectMessage);
}
