/**
 * Plugin registration.
 *
 * Maps the runtime's events onto the plugin's hook contract and registers the
 * plugin's tools. The runtime event shape is converted here and nowhere else;
 * handlers only ever see the plugin's own events.
 */

import { z } from "zod";
import { memLog } from "../logging";
import type { ToolDefinition } from "../tools/define-tool";
import type {
  CompactionEvent,
  MessagesEvent,
  MessagePart,
  MessageView,
  OptionsEvent,
  PluginEvent,
  PluginHooks,
  PromptEvent,
  SystemEvent,
  ToolAfterEvent,
  ToolBeforeEvent,
} from "./hooks/types";

export interface PluginLocation {
  /** The directory the runtime serves (may be `$HOME` for a global install). */
  directory: string;
  /** Project metadata — authoritative when present. */
  project?:
    | {
        directory?: string | undefined;
        canonical?: string | undefined;
      }
    | undefined;
}

export interface PluginContext {
  location: PluginLocation;
  options?: Record<string, unknown>;
  session: {
    prompt: (input: Record<string, unknown>) => Promise<unknown>;
    context?: (input: Record<string, unknown>) => Promise<unknown>;
    hook: (name: string, cb: (event: never) => Promise<void> | void) => Promise<{ dispose: () => Promise<void> }>;
  };
  tool: {
    hook: (name: string, cb: (event: never) => Promise<void> | void) => Promise<{ dispose: () => Promise<void> }>;
    transform: (cb: (editor: ToolEditor) => void) => Promise<{ dispose: () => Promise<void> }>;
    list: () => Promise<Array<{ id: string }>>;
  };
  event: {
    subscribe: (
      options?: { signal?: AbortSignal },
    ) => AsyncIterable<{ type: string; properties?: Record<string, unknown>; data?: Record<string, unknown> }>;
  };
}

/**
 * Resolve the directory that owns this location's memory.
 *
 * A globally registered plugin boots with `location.directory = $HOME`; project
 * metadata is the only reliable project root. Never prefer the location
 * directory when project metadata exists — that would point the store and the
 * code graph at the whole home directory.
 */
export function resolveProjectDirectory(location: PluginLocation): string {
  return location.project?.canonical ?? location.project?.directory ?? location.directory;
}

interface ToolEditor {
  add: (tool: ToolDefinitionInfo) => void;
  update: (id: string, update: (tool: ToolDefinitionInfo) => void) => void;
  get?: (id: string) => (ToolDefinitionInfo & { id: string }) | undefined;
  list?: () => ReadonlyArray<ToolDefinitionInfo & { id: string }>;
}

interface ToolDefinitionInfo {
  name: string;
  description: string;
  input: unknown;
  options?: { namespace?: string | undefined; codemode?: boolean | undefined } | undefined;
  execute: (input: unknown, context: unknown) => Promise<{ content?: string; output?: string; metadata?: unknown }>;
}

/** A runtime message: `{id?, role, metadata?, content: ContentPart[]}`. */
interface RuntimeMessage {
  id?: string | undefined;
  role: string;
  metadata?: Record<string, unknown> | undefined;
  content: MessagePart[];
}

/** A message view plus the runtime message it came from. */
interface MessageEntry extends MessageView {
  original?: RuntimeMessage | undefined;
}

/**
 * Convert a tool definition (zod args) into the runtime's tool definition
 * (JSON Schema args). `z.toJSONSchema` turns the raw shape into the schema
 * the runtime validates the model's arguments against.
 */
export function toToolDefinition(name: string, def: ToolDefinition): ToolDefinitionInfo {
  const args = def.args ?? {};
  let input: unknown;
  try {
    input = z.toJSONSchema(z.object(args));
  } catch (err) {
    memLog("warn", "registration", "Failed to convert tool args to JSON Schema", {
      tool: name,
      error: err instanceof Error ? err.message : String(err),
    });
    input = { type: "object", properties: {}, additionalProperties: true };
  }
  return {
    name,
    description: def.description ?? "",
    input,
    execute: async (toolInput: unknown, ctx: unknown) => {
      const result = await def.execute(toolInput as never, ctx as never);
      if (typeof result === "string") return { content: result };
      const obj = (result ?? {}) as { output?: string; content?: string; metadata?: unknown; title?: string };
      return {
        content: obj.output ?? obj.content ?? obj.title ?? "",
        metadata: obj.metadata,
      };
    },
  };
}

/**
 * Build the plugin's message views from the runtime's messages.
 *
 * `parts` is the SAME array object as the runtime message's `content`, so a
 * handler that appends a part mutates the original message in place. Copying
 * the parts would strip the type-specific payloads (tool calls, tool results)
 * and break the outgoing model request.
 */
function toMessageViews(messages: readonly RuntimeMessage[]): MessageEntry[] {
  return messages.map((m) => {
    const metadata = m.metadata ?? {};
    return {
      id: m.id,
      role: m.role,
      type: typeof metadata["type"] === "string" ? metadata["type"] : undefined,
      tokens: typeof metadata["tokens"] === "number" ? metadata["tokens"] : undefined,
      metadata,
      parts: m.content as MessagePart[],
      original: m,
    };
  });
}

/**
 * Write the handlers' changes back onto the runtime messages.
 *
 * Original messages are mutated in place so every field the plugin does not
 * know about survives. Only messages a handler inserted are converted.
 */
function applyMessageViews(entries: readonly MessageEntry[]): RuntimeMessage[] {
  return entries.map((entry) => {
    const original = entry.original;
    if (!original) {
      return {
        id: entry.id,
        role: (entry.role ?? "user") as RuntimeMessage["role"],
        content: (entry.parts ?? []).map((p) => ({ type: p.type, text: p.text })),
      };
    }
    const parts = entry.parts as unknown as RuntimeMessage["content"] | undefined;
    if (Array.isArray(parts) && parts !== original.content) original.content = parts;
    return original;
  });
}

export interface PluginSetup {
  handlers: PluginHooks;
  toolMap: Record<string, ToolDefinition>;
  /** Shared teardown (stop management server, close store). */
  dispose: () => Promise<void>;
}

/**
 * Register the plugin's hooks and tools on a runtime context.
 * Returns a cleanup function for the resources the plugin owns.
 */
export async function registerPlugin(ctx: PluginContext, setup: PluginSetup): Promise<() => Promise<void>> {
  const { handlers, toolMap } = setup;
  const disposables: Array<{ dispose: () => Promise<void> }> = [];

  /**
   * A plugin hook must never break the session it observes. Every registered
   * callback runs through this guard: failures are logged and swallowed.
   */
  const guard =
    (name: string, fn: (event: never) => Promise<void>) =>
    async (event: never): Promise<void> => {
      try {
        await fn(event);
      } catch (err) {
        memLog("warn", "registration", `hook failed: ${name}`, {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.split("\n")[1]?.trim() : undefined,
        });
      }
    };

  // ---- tool.execute.before ------------------------------------------------
  if (handlers["tool.execute.before"]) {
    const reg = await ctx.tool.hook(
      "execute.before",
      guard("tool.execute.before", async (event: never) => {
        const e = event as unknown as { tool: string; sessionID: string; id: string; input: unknown };
        const args = (e.input ?? {}) as Record<string, unknown>;
        const pluginEvent: ToolBeforeEvent = {
          tool: e.tool,
          sessionID: e.sessionID,
          callID: e.id,
          args,
        };
        await handlers["tool.execute.before"]?.(pluginEvent);
        e.input = pluginEvent.args;
      }),
    );
    disposables.push(reg);
  }

  // ---- tool.execute.after -------------------------------------------------
  if (handlers["tool.execute.after"]) {
    const reg = await ctx.tool.hook(
      "execute.after",
      guard("tool.execute.after", async (event: never) => {
        const e = event as unknown as {
          tool: string;
          sessionID: string;
          id: string;
          input: unknown;
          status: string;
          result?: Record<string, unknown>;
          error?: unknown;
        };
        const result = e.result ?? {};
        const content = result["content"];
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? ((content as Array<{ type?: string; text?: string }>).find((p) => p?.type === "text")?.text ?? "")
              : "";
        const pluginEvent: ToolAfterEvent = {
          tool: e.tool,
          sessionID: e.sessionID,
          callID: e.id,
          args: (e.input ?? {}) as Record<string, unknown>,
          output: typeof result["output"] === "string" ? (result["output"] as string) : text,
          title: typeof result["title"] === "string" ? (result["title"] as string) : undefined,
          metadata: result["metadata"] as Record<string, unknown> | undefined,
        };
        await handlers["tool.execute.after"]?.(pluginEvent);

        // The runtime's result object is `{output?, content?, metadata?}` — it
        // has no `title`. Writing a field the schema does not have, or
        // replacing an object-shaped output with a string, breaks the outgoing
        // request. Only touch fields that already exist, with the same type.
        if (e.status === "completed" && e.result) {
          const r = e.result;
          if (typeof r["output"] === "string") r["output"] = pluginEvent.output;
          if (typeof r["content"] === "string") r["content"] = pluginEvent.output;
          else if (Array.isArray(r["content"])) {
            const parts = r["content"] as Array<{ type?: string; text?: string }>;
            const first = parts.find((p) => p?.type === "text");
            if (first && typeof first.text === "string") first.text = pluginEvent.output;
          }
          if (r["metadata"] !== undefined) r["metadata"] = pluginEvent.metadata;
        }
      }),
    );
    disposables.push(reg);
  }

  // ---- session.context (system + messages + options) ----------------------
  if (handlers.system || handlers.messages || handlers.options) {
    const reg = await ctx.session.hook(
      "context",
      guard("session.context", async (event: never) => {
        const e = event as unknown as {
          sessionID: string;
          system: Array<{ type: string; text?: string }>;
          messages: RuntimeMessage[];
          options: Record<string, unknown>;
          tools?: Record<string, unknown>;
          model?: { providerID: string; id: string };
        };

        if (handlers.system) {
          const system = (e.system ?? []).map((p) => p.text ?? "");
          const pluginEvent: SystemEvent = { sessionID: e.sessionID, system };
          await handlers.system(pluginEvent);
          // Keep the original parts, append the newly added text.
          const original = e.system ?? [];
          const merged = original.slice();
          for (let i = original.length; i < pluginEvent.system.length; i++) {
            merged.push({ type: "text", text: pluginEvent.system[i] ?? "" });
          }
          e.system = merged;
        }

        if (handlers.messages) {
          const views = toMessageViews(e.messages ?? []);
          const pluginEvent: MessagesEvent = {
            sessionID: e.sessionID,
            messages: views,
            model: e.model,
          };
          await handlers.messages(pluginEvent);
          e.messages = applyMessageViews(views);
        }

        if (handlers.options) {
          const current = e.options ?? {};
          const pluginEvent: OptionsEvent = {
            sessionID: e.sessionID,
            temperature: current["temperature"] as number | undefined,
            topP: current["topP"] as number | undefined,
            topK: current["topK"] as number | undefined,
            maxOutputTokens: current["maxTokens"] as number | undefined,
          };
          await handlers.options(pluginEvent);
          // The runtime forwards unknown option keys to the provider, so only
          // the documented generation options are written back.
          const next: Record<string, unknown> = { ...current };
          if (typeof pluginEvent.temperature === "number") next["temperature"] = pluginEvent.temperature;
          if (typeof pluginEvent.topP === "number") next["topP"] = pluginEvent.topP;
          if (typeof pluginEvent.topK === "number") next["topK"] = pluginEvent.topK;
          if (typeof pluginEvent.maxOutputTokens === "number") next["maxTokens"] = pluginEvent.maxOutputTokens;
          e.options = next;
        }
      }),
    );
    disposables.push(reg);
  }

  // ---- session.prompt -----------------------------------------------------
  if (handlers.message) {
    const reg = await ctx.session.hook(
      "prompt",
      guard("session.prompt", async (event: never) => {
        const e = event as unknown as { sessionID: string; prompt: unknown };
        const pluginEvent: PromptEvent = { sessionID: e.sessionID, message: e.prompt, parts: [] };
        await handlers.message?.(pluginEvent);
      }),
    );
    disposables.push(reg);
  }

  // ---- session.compaction -------------------------------------------------
  if (handlers.compaction) {
    const reg = await ctx.session.hook(
      "compaction",
      guard("session.compaction", async (event: never) => {
        const e = event as unknown as { sessionID: string };
        const pluginEvent: CompactionEvent = { sessionID: e.sessionID, context: [] };
        await handlers.compaction?.(pluginEvent);
        if (pluginEvent.context.length > 0) {
          memLog("info", "registration", "compaction capture produced context", {
            lines: pluginEvent.context.length,
          });
        }
      }),
    );
    disposables.push(reg);
  }

  // ---- tools --------------------------------------------------------------
  const toolNames = Object.keys(toolMap);
  const toolErrors: Array<{ tool: string; error: string }> = [];
  const ignored: string[] = [];
  const toolReg = await ctx.tool.transform((editor) => {
    for (const name of toolNames) {
      const def = toolMap[name];
      if (!def) continue;
      try {
        editor.add(toToolDefinition(name, def));
        // `add` never throws on a definition it dislikes — it just does
        // nothing. Read the editor back to find out whether it landed.
        try {
          if (typeof editor.get === "function" && editor.get(name) === undefined) ignored.push(name);
        } catch {
          /* read-back unsupported — the registry snapshot below covers it */
        }
      } catch (err) {
        toolErrors.push({ tool: name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
  disposables.push(toolReg);
  memLog(toolErrors.length > 0 || ignored.length > 0 ? "warn" : "info", "registration", "tool registration applied", {
    requested: toolNames.length,
    added: toolNames.length - toolErrors.length - ignored.length,
    ignored,
    errors: toolErrors.slice(0, 5),
  });

  try {
    const registered = await ctx.tool.list();
    const ids = registered.map((t) => t.id).filter(Boolean);
    const ours = ids.filter((id) => toolNames.some((n) => id === n || id.endsWith(`_${n}`)));
    memLog("info", "registration", "tool registry snapshot at setup", {
      entries: ids.length,
      ours: ours.length,
      missing: toolNames.filter((n) => !ours.some((id) => id === n || id.endsWith(`_${n}`))),
    });
  } catch (err) {
    memLog("warn", "registration", "tool registry snapshot failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ---- event stream -------------------------------------------------------
  if (handlers.event) {
    const controller = new AbortController();
    const EVENT_TRACE_LIMIT = 30;
    let traced = 0;
    let received = 0;
    memLog("info", "registration", "event stream subscribed");
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            // V2 frames: {type, data} (payload under `data`); the V1 compat
            // shape: {type, properties}; a `sync` envelope wraps the real
            // event in `syncEvent` with a versioned type ("session.idle.1").
            const raw = event as unknown as {
              type?: string;
              properties?: Record<string, unknown>;
              data?: Record<string, unknown>;
              syncEvent?: { type?: string; data?: Record<string, unknown> };
            };
            let type = typeof raw.type === "string" ? raw.type : "";
            let payload = raw.data ?? raw.properties;
            let payloadSource = raw.data ? "data" : raw.properties ? "properties" : "none";
            if (type === "sync" && raw.syncEvent) {
              type = typeof raw.syncEvent.type === "string"
                ? raw.syncEvent.type.replace(/\.\d+$/, "")
                : "";
              payload = raw.syncEvent.data ?? payload;
              payloadSource = "sync";
            }
            received++;
            // Trace what actually arrives: first N events always, plus every
            // session.* event — that's where the idle/created fixes must land.
            if (traced < EVENT_TRACE_LIMIT || type.startsWith("session.")) {
              traced++;
              memLog("info", "registration", "event received", {
                type,
                payloadSource,
                payloadKeys: payload ? Object.keys(payload).join(",") : "",
                rawKeys: Object.keys(event as unknown as Record<string, unknown>).join(","),
                received,
              });
            }
            const pluginEvent: PluginEvent = {
              type,
              properties: payload ?? {},
            };
            await handlers.event?.(pluginEvent);
          } catch (err) {
            memLog("error", "registration", "Event handler failed", { type: event.type, error: String(err) });
          }
        }
        // A completed iterable (no throw) previously exited silently.
        memLog("warn", "registration", "event stream completed (iterable ended)", { received, traced });
      } catch (err) {
        memLog("error", "registration", "Event subscription ended", { error: String(err) });
      }
    })();
    disposables.push({ dispose: async () => controller.abort() });
  }

  // ---- cleanup ------------------------------------------------------------
  return async () => {
    for (const reg of disposables.reverse()) {
      try {
        await reg.dispose();
      } catch (err) {
        memLog("warn", "registration", "Failed to dispose registration", { error: String(err) });
      }
    }
    await setup.dispose();
  };
}
