/**
 * OpenCode V2 adapter.
 *
 * V1 plugins return a single object of string-keyed hooks plus a `tool` map.
 * V2 plugins register each hook on the domain that owns the operation, and
 * the callback receives ONE mutable event instead of separate `input` and
 * `output` objects.
 *
 * This module bridges the existing V1 handlers onto the V2 domains without
 * changing their logic. Every handler keeps receiving the V1 `(input,
 * output)` pair it was written against; the adapter converts the V2 event
 * into that pair, runs the handler, and writes the mutated `output` back
 * onto the V2 event.
 */

import { tool as v1Tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { memLog } from "../logging";
import { createV2Client } from "./v2-client";
import type { V2ClientLike } from "./v2-client";

/** V1 hook map as returned by `createHookHandlers`. */
type V1Handlers = Record<string, unknown>;

export interface V2Context {
  location: { directory: string };
  options?: Record<string, unknown>;
  session: {
    prompt: (input: Record<string, unknown>) => Promise<unknown>;
    context?: (input: Record<string, unknown>) => Promise<unknown>;
    hook: (name: string, cb: (event: never) => Promise<void> | void) => Promise<{ dispose: () => Promise<void> }>;
  };
  tool: {
    hook: (name: string, cb: (event: never) => Promise<void> | void) => Promise<{ dispose: () => Promise<void> }>;
    transform: (cb: (editor: V2ToolEditor) => void) => Promise<{ dispose: () => Promise<void> }>;
  };
  event: {
    subscribe: (options?: { signal?: AbortSignal }) => AsyncIterable<{ type: string; properties?: Record<string, unknown> }>;
  };
}

interface V2ToolEditor {
  add: (tool: V2ToolInfo) => void;
  update: (id: string, update: (tool: V2ToolInfo) => void) => void;
}

interface V2ToolInfo {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context: unknown) => Promise<{ content?: string; output?: string; metadata?: unknown }>;
}

type ToolHandler = (input: unknown, output: unknown) => Promise<void>;
/** The V1 `event` hook takes a single argument (unlike the two-arg hooks). */
type EventHandler = (input: { event: { type: string; properties: Record<string, unknown> } }) => Promise<void>;

/**
 * Convert a V1 tool definition (zod args) into a V2 tool definition
 * (JSON Schema args). `tool.schema` is the same zod instance that built the
 * args, so `toJSONSchema` works without cross-version zod breakage.
 */
export function toV2Tool(name: string, def: ToolDefinition): V2ToolInfo {
  const args = (def as unknown as { args?: Record<string, unknown> }).args ?? {};
  const z = v1Tool.schema as unknown as {
    object: (shape: Record<string, unknown>) => unknown;
    toJSONSchema: (schema: unknown) => unknown;
  };
  let input: unknown;
  try {
    input = z.toJSONSchema(z.object(args));
  } catch (err) {
    memLog("warn", "v2-adapter", "Failed to convert tool args to JSON Schema", { tool: name, error: String(err) });
    input = { type: "object", properties: {}, additionalProperties: true };
  }
  return {
    name,
    description: def.description ?? "",
    input,
    execute: async (toolInput: unknown, ctx: unknown) => {
      const result = await def.execute(toolInput as never, ctx as never);
      // V1 tools return a string (or {title, output, metadata}); V2 expects
      // structured content.
      if (typeof result === "string") return { content: result };
      const obj = (result ?? {}) as { output?: string; content?: string; metadata?: unknown; title?: string };
      return {
        content: obj.output ?? obj.content ?? obj.title ?? "",
        metadata: obj.metadata,
      };
    },
  };
}

/** V2 message: {id?, role, content: ContentPart[]}. */
interface V2Message {
  id?: string | undefined;
  role: string;
  content: Array<{ type: string; text?: string | undefined }>;
}

/** V1 message: {info: {role}, parts: Part[]}. */
interface V1Message {
  info: { role: string; content?: string | undefined; id?: string | undefined };
  parts: Array<{ type: string; text?: string | undefined }>;
}

function v2ToV1Messages(messages: readonly V2Message[]): V1Message[] {
  return messages.map((m) => ({
    info: { role: m.role, content: "", id: m.id },
    parts: (m.content ?? []).map((part) =>
      part.type === "text" ? { type: "text", text: part.text ?? "" } : { type: part.type },
    ),
  }));
}

function v1ToV2Messages(messages: readonly V1Message[]): V2Message[] {
  return messages.map((m) => ({
    id: m.info?.id,
    role: m.info?.role ?? "user",
    content: (m.parts ?? []).map((p) =>
      p.type === "text" ? { type: "text", text: p.text ?? "" } : { type: p.type },
    ),
  }));
}

export interface V2SetupInput {
  handlers: V1Handlers;
  toolMap: Record<string, ToolDefinition>;
  /** Shared teardown (stop management server, close store). */
  dispose: () => Promise<void>;
}

/**
 * Register the plugin's hooks, tools, and event subscription on a V2 context.
 * Returns a cleanup function for resources the plugin owns.
 */
export async function setupV2(ctx: V2Context, input: V2SetupInput): Promise<() => Promise<void>> {
  const { handlers, toolMap } = input;
  const disposables: Array<{ dispose: () => Promise<void> }> = [];

  const get = (key: string): ToolHandler | undefined => {
    const h = handlers[key];
    return typeof h === "function" ? (h as ToolHandler) : undefined;
  };

  // ---- tool.execute.before -> ctx.tool.hook("execute.before") -------------
  // V1: (input: {tool, sessionID, callID}, output: {args})
  // V2: event {tool, sessionID, id, input} — `input` holds the args.
  const toolBefore = get("tool.execute.before");
  if (toolBefore) {
    const reg = await ctx.tool.hook("execute.before", async (event: never) => {
      const e = event as unknown as { tool: string; sessionID: string; id: string; input: unknown };
      const output = { args: e.input };
      await toolBefore({ tool: e.tool, sessionID: e.sessionID, callID: e.id }, output);
      e.input = output.args;
    });
    disposables.push(reg);
  }

  // ---- tool.execute.after -> ctx.tool.hook("execute.after") ---------------
  // V1: (input: {tool, sessionID, callID, args}, output: {title, output, metadata})
  // V2: event {tool, sessionID, id, input, status, result|error}
  const toolAfter = get("tool.execute.after");
  if (toolAfter) {
    const reg = await ctx.tool.hook("execute.after", async (event: never) => {
      const e = event as unknown as {
        tool: string;
        sessionID: string;
        id: string;
        input: unknown;
        status: string;
        result?: { title?: string; output?: string; content?: string; metadata?: unknown };
        error?: unknown;
      };
      const output = {
        title: e.result?.title ?? "",
        output: e.result?.output ?? e.result?.content ?? "",
        metadata: e.result?.metadata,
      };
      await toolAfter(
        { tool: e.tool, sessionID: e.sessionID, callID: e.id, args: e.input },
        output,
      );
      // V2's Tool.Result fields are readonly — replace the result object.
      if (e.status === "completed" && e.result) {
        e.result = {
          ...e.result,
          title: output.title,
          output: output.output,
          metadata: output.metadata,
        };
      }
    });
    disposables.push(reg);
  }

  // ---- system + messages transform + chat.params -> ctx.session.hook("context")
  // V1 split these across three hooks; V2 funnels all model-visible context
  // through one "context" hook with `system`, `messages`, and `options`.
  const systemTransform = get("experimental.chat.system.transform");
  const messagesTransform = get("experimental.chat.messages.transform");
  const chatParams = get("chat.params");
  if (systemTransform || messagesTransform || chatParams) {
    const reg = await ctx.session.hook("context", async (event: never) => {
      const e = event as unknown as {
        sessionID: string;
        system: Array<{ type: string; text?: string }>;
        messages: V2Message[];
        options: Record<string, unknown>;
      };

      if (systemTransform) {
        const output = { system: (e.system ?? []).map((p) => p.text ?? "") };
        await systemTransform({ sessionID: e.sessionID, model: {} }, output);
        // Write back: keep the original part objects where possible, append
        // newly added system strings as text parts.
        const original = e.system ?? [];
        const next = output.system ?? [];
        const merged = original.slice();
        for (let i = original.length; i < next.length; i++) {
          merged.push({ type: "text", text: next[i] ?? "" });
        }
        e.system = merged;
      }

      if (messagesTransform) {
        const v1Messages = v2ToV1Messages(e.messages ?? []);
        const output = { messages: v1Messages };
        await messagesTransform({}, output);
        e.messages = v1ToV2Messages(output.messages ?? []);
      }

      if (chatParams) {
        // V1 wrote {temperature, topP, topK, maxOutputTokens, options}.
        // V2 exposes semantic generation options directly on event.options.
        const output = {
          temperature: (e.options?.temperature as number) ?? 0,
          topP: (e.options?.topP as number) ?? 0,
          topK: (e.options?.topK as number) ?? 0,
          maxOutputTokens: e.options?.maxOutputTokens as number | undefined,
          options: (e.options?.options as Record<string, unknown>) ?? {},
        };
        await chatParams({ sessionID: e.sessionID, agent: "", model: {}, provider: {}, message: {} }, output);
        e.options = {
          ...e.options,
          temperature: output.temperature,
          topP: output.topP,
          topK: output.topK,
          maxOutputTokens: output.maxOutputTokens,
          options: output.options,
        };
      }
    });
    disposables.push(reg);
  }

  // ---- chat.message -> ctx.session.hook("prompt") ------------------------
  const chatMessage = get("chat.message");
  if (chatMessage) {
    const reg = await ctx.session.hook("prompt", async (event: never) => {
      const e = event as unknown as { sessionID: string; prompt: unknown };
      const output = { message: e.prompt, parts: [] as unknown[] };
      await chatMessage({ sessionID: e.sessionID }, output);
    });
    disposables.push(reg);
  }

  // ---- experimental.session.compacting -> ctx.session.hook("compaction") --
  const compacting = get("experimental.session.compacting");
  if (compacting) {
    const reg = await ctx.session.hook("compaction", async (event: never) => {
      const e = event as unknown as {
        sessionID: string;
        result?: { summary?: string; metadata?: Record<string, unknown>; tokens?: unknown };
      };
      const output = { summary: e.result?.summary ?? "" };
      await compacting({ sessionID: e.sessionID }, output);
      if (output.summary) {
        e.result = { ...(e.result ?? {}), summary: output.summary };
      }
    });
    disposables.push(reg);
  }

  // ---- tool map -> ctx.tool.transform ------------------------------------
  // Transforms are replayable state edits: keep the callback synchronous and
  // side-effect free.
  const toolNames = Object.keys(toolMap);
  const toolReg = await ctx.tool.transform((editor) => {
    for (const name of toolNames) {
      const def = toolMap[name];
      if (!def) continue;
      editor.add(toV2Tool(name, def));
    }
  });
  disposables.push(toolReg);

  // ---- event -> ctx.event.subscribe() ------------------------------------
  const eventHandler = handlers["event"];
  if (typeof eventHandler === "function") {
    const onEvent = eventHandler as EventHandler;
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await onEvent({ event: { type: event.type, properties: event.properties ?? {} } });
          } catch (err) {
            memLog("error", "v2-adapter", "Event handler failed", { type: event.type, error: String(err) });
          }
        }
      } catch (err) {
        memLog("error", "v2-adapter", "Event subscription ended", { error: String(err) });
      }
    })();
    disposables.push({ dispose: async () => controller.abort() });
  }

  // ---- cleanup -----------------------------------------------------------
  return async () => {
    for (const reg of disposables.reverse()) {
      try {
        await reg.dispose();
      } catch (err) {
        memLog("warn", "v2-adapter", "Failed to dispose registration", { error: String(err) });
      }
    }
    await input.dispose();
  };
}

export { createV2Client };
export type { V2ClientLike };
