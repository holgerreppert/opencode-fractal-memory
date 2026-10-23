import { describe, expect, test } from "bun:test";
import { registerPlugin, resolveProjectDirectory, toToolDefinition } from "./registration";
import type { PluginContext } from "./registration";
import type { ToolDefinition } from "../tools/define-tool";
import { tool } from "../tools/define-tool";

/**
 * Mock plugin context that records every registration the plugin performs.
 * Mirrors the runtime API surface: domains own their hooks, transforms are
 * editor-based, and events arrive through an async subscription.
 */
function createMockCtx() {
  const toolHooks = new Map<string, (event: unknown) => Promise<void> | void>();
  const sessionHooks = new Map<string, (event: unknown) => Promise<void> | void>();
  const transforms: Array<(editor: unknown) => void> = [];
  const disposed: string[] = [];
  const eventHandlers: Array<(event: { type: string; properties?: Record<string, unknown>; data?: Record<string, unknown> }) => void> = [];
  const registeredTools: Array<{ name: string }> = [];

  const ctx = {
    location: { directory: "/tmp/v2-test-project" },
    options: {},
    session: {
      prompt: async () => ({}),
      context: async () => [],
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        sessionHooks.set(name, cb);
        return { dispose: async () => { disposed.push(`session:${name}`); } };
      },
    },
    tool: {
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        toolHooks.set(name, cb);
        return { dispose: async () => { disposed.push(`tool:${name}`); } };
      },
      transform: async (cb: (editor: unknown) => void) => {
        transforms.push(cb);
        return { dispose: async () => { disposed.push("tool:transform"); } };
      },
      list: async () => registeredTools.map((t) => ({ id: t.name })),
    },
    event: {
      subscribe: (options?: { signal?: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          const queue = eventHandlers;
          while (true) {
            if (options?.signal?.aborted) return;
            const next = queue.shift();
            if (!next) {
              await new Promise((r) => setTimeout(r, 5));
              if (options?.signal?.aborted) return;
              continue;
            }
            yield next;
          }
        },
      }),
    },
  } as unknown as PluginContext;

  return { ctx, toolHooks, sessionHooks, transforms, disposed, eventHandlers, registeredTools };
}

describe("plugin registration", () => {
  test("registers hooks and tools on their domains", async () => {
    const mock = createMockCtx();
    const cleanup = await registerPlugin(mock.ctx, {
      handlers: {
        "tool.execute.before": async () => {},
        "tool.execute.after": async () => {},
        system: async () => {},
        messages: async () => {},
        options: async () => {},
        message: async () => {},
        compaction: async () => {},
        event: async () => {},
      },
      toolMap: {},
      dispose: async () => {},
    });

    expect(mock.toolHooks.has("execute.before")).toBe(true);
    expect(mock.toolHooks.has("execute.after")).toBe(true);
    expect(mock.sessionHooks.has("context")).toBe(true);
    expect(mock.sessionHooks.has("prompt")).toBe(true);
    expect(mock.sessionHooks.has("compaction")).toBe(true);
    expect(mock.transforms.length).toBe(1);

    await cleanup();
    expect(mock.disposed).toContain("tool:execute.before");
    expect(mock.disposed).toContain("session:context");
  });

  test("omits hooks that have no handler", async () => {
    const mock = createMockCtx();
    await registerPlugin(mock.ctx, {
      handlers: { "tool.execute.before": async () => {} },
      toolMap: {},
      dispose: async () => {},
    });

    expect(mock.toolHooks.has("execute.before")).toBe(true);
    expect(mock.toolHooks.has("execute.after")).toBe(false);
    expect(mock.sessionHooks.has("context")).toBe(false);
    expect(mock.sessionHooks.has("prompt")).toBe(false);
  });

  test("registers every tool from the tool map through tool.transform", async () => {
    const mock = createMockCtx();
    const added: Array<{ name: string }> = [];
    await registerPlugin(mock.ctx, {
      handlers: {},
      toolMap: {
        memory_search: tool({
          description: "Search memory",
          args: { query: tool.schema.string().describe("keywords") },
          async execute() { return "ok"; },
        }) as ToolDefinition,
      },
      dispose: async () => {},
    });

    const editor = { add: (t: { name: string }) => { added.push(t); } };
    mock.transforms[0]!(editor);

    expect(added.map((t) => t.name)).toEqual(["memory_search"]);
  });

  test("tool.execute.before passes the args on the event and writes them back", async () => {
    const mock = createMockCtx();
    await registerPlugin(mock.ctx, {
      handlers: {
        "tool.execute.before": async (event) => {
          event.args = { filePath: "/mutated" };
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = { tool: "read", sessionID: "ses_1", id: "call_1", input: { filePath: "/original" } };
    await mock.toolHooks.get("execute.before")?.(event);

    expect((event as { input: { filePath: string } }).input.filePath).toBe("/mutated");
  });

  test("tool.execute.after writes the mutated output back into the result", async () => {
    const mock = createMockCtx();
    await registerPlugin(mock.ctx, {
      handlers: {
        "tool.execute.after": async (event) => {
          event.output = "compressed";
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = {
      tool: "bash",
      sessionID: "ses_1",
      id: "call_1",
      input: {},
      status: "completed",
      result: { output: "raw" },
    };
    await mock.toolHooks.get("execute.after")?.(event);

    const result = (event as { result: { output: string } }).result;
    expect(result.output).toBe("compressed");
  });

  test("tool.execute.after replaces the text part of a content array", async () => {
    const mock = createMockCtx();
    await registerPlugin(mock.ctx, {
      handlers: {
        "tool.execute.after": async (event) => {
          event.output = "compressed";
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = {
      tool: "bash",
      sessionID: "ses_1",
      id: "call_1",
      input: {},
      status: "completed",
      result: { content: [{ type: "text", text: "raw" }], metadata: { exit: 0 } },
    };
    await mock.toolHooks.get("execute.after")?.(event);

    const result = (event as { result: { content: Array<{ text: string }>; metadata: unknown } }).result;
    expect(result.content[0]?.text).toBe("compressed");
    expect(result.metadata).toEqual({ exit: 0 });
  });

  test("tool.execute.after never overwrites an object-shaped output with a string", async () => {
    const mock = createMockCtx();
    await registerPlugin(mock.ctx, {
      handlers: {
        "tool.execute.after": async (event) => {
          event.output = "compressed";
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = {
      tool: "read",
      sessionID: "ses_1",
      id: "call_1",
      input: {},
      status: "completed",
      result: { output: { content: "raw" } },
    };
    await mock.toolHooks.get("execute.after")?.(event);

    const result = (event as { result: { output: unknown } }).result;
    expect(result.output).toEqual({ content: "raw" });
  });

  test("messages hook receives the runtime messages and its changes are written back", async () => {
    const mock = createMockCtx();
    let seen: Array<{ role?: string }> = [];
    await registerPlugin(mock.ctx, {
      handlers: {
        messages: async (event) => {
          seen = event.messages;
          event.messages.push({ role: "user", parts: [{ type: "text", text: "[injected]" }] });
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const toolResultPart = {
      type: "tool-result",
      toolCallId: "call_1",
      result: { type: "text", value: "done" },
    };
    const original = {
      id: "m1",
      role: "assistant",
      metadata: { cached: true },
      content: [toolResultPart],
    };
    const event = {
      sessionID: "ses_1",
      system: [],
      messages: [original],
      options: {},
    };
    await mock.sessionHooks.get("context")?.(event);

    expect(seen[0]?.role).toBe("assistant");
    const messages = (event as { messages: Array<{ content: Array<Record<string, unknown>>; metadata?: unknown }> }).messages;
    // The original message keeps every field it had.
    expect(messages[0]?.content[0]).toBe(toolResultPart);
    expect((messages[0]?.content[0] as { result?: { type?: string } })?.result?.type).toBe("text");
    expect(messages[0]?.metadata).toEqual({ cached: true });
    // The injected message is added.
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content[0]).toEqual({ type: "text", text: "[injected]" });
  });

  test("options hook maps maxOutputTokens onto the runtime's maxTokens", async () => {
    const mock = createMockCtx();
    await registerPlugin(mock.ctx, {
      handlers: {
        options: async (event) => {
          event.maxOutputTokens = 4096;
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = {
      sessionID: "ses_1",
      system: [],
      messages: [],
      options: { temperature: 0.7 },
    };
    await mock.sessionHooks.get("context")?.(event);

    const options = (event as { options: Record<string, unknown> }).options;
    expect(options.maxTokens).toBe(4096);
    expect(options.temperature).toBe(0.7);
    // Unknown keys are forwarded to the provider as provider options.
    expect(options.maxOutputTokens).toBeUndefined();
    expect(options.options).toBeUndefined();
  });

  test("maps the runtime event payload onto the plugin's event shape", async () => {
    const mock = createMockCtx();
    const seen: Array<{ type: string; properties?: Record<string, unknown> }> = [];
    await registerPlugin(mock.ctx, {
      handlers: {
        event: async (event) => {
          seen.push(event);
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    mock.eventHandlers.push({
      type: "session.idle",
      // The runtime delivers an event's payload in `data`.
      data: { sessionID: "ses_abc" },
    } as unknown as { type: string; properties?: Record<string, unknown> });

    await new Promise((r) => setTimeout(r, 30));

    const idle = seen.find((e) => e.type === "session.idle");
    // Without this mapping the session id is "unknown" and every
    // session-scoped call fails with 'Expected a string starting with "ses"'.
    expect(idle?.properties?.["sessionID"]).toBe("ses_abc");
  });
});

describe("toToolDefinition", () => {
  test("converts zod args to JSON Schema with required and descriptions", () => {
    const def = tool({
      description: "Search memory",
      args: {
        query: tool.schema.string().describe("Concise keywords"),
        limit: tool.schema.number().int().positive().optional(),
        mode: tool.schema.enum(["search", "fetch"]).optional(),
      },
      async execute() { return "ok"; },
    });

    const converted = toToolDefinition("memory_search", def);
    const schema = converted.input as {
      type: string;
      properties: Record<string, { type?: string; description?: string; enum?: string[] }>;
      required: string[];
    };

    expect(schema.type).toBe("object");
    expect(schema.properties.query?.type).toBe("string");
    expect(schema.properties.query?.description).toBe("Concise keywords");
    expect(schema.properties.limit?.type).toBe("integer");
    expect(schema.properties.mode?.enum).toEqual(["search", "fetch"]);
    expect(schema.required).toEqual(["query"]);
  });

  test("wraps a string tool result into the runtime's content", async () => {
    const def = tool({
      description: "Echo",
      args: { value: tool.schema.string() },
      async execute(args) { return `echo:${args.value}`; },
    });

    const converted = toToolDefinition("echo", def);
    const result = await converted.execute({ value: "hi" }, {});
    expect(result.content).toBe("echo:hi");
  });
});

describe("resolveProjectDirectory", () => {
  test("prefers the canonical project directory", () => {
    expect(
      resolveProjectDirectory({
        directory: "/home/user",
        project: { directory: "/home/user/work/repo", canonical: "/real/repo" },
      }),
    ).toBe("/real/repo");
  });

  test("falls back to the project directory", () => {
    expect(
      resolveProjectDirectory({ directory: "/home/user", project: { directory: "/home/user/work/repo" } }),
    ).toBe("/home/user/work/repo");
  });

  test("never prefers the location directory when project metadata exists", () => {
    expect(resolveProjectDirectory({ directory: "/home/user", project: { canonical: "/repo" } })).toBe("/repo");
  });

  test("uses the location directory only without project metadata", () => {
    expect(resolveProjectDirectory({ directory: "/home/user" })).toBe("/home/user");
  });
});
