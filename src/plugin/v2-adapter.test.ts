import { describe, expect, test } from "bun:test";
import { tool } from "@opencode-ai/plugin";
import { setupV2, toV2Tool } from "./v2-adapter";
import type { V2Context } from "./v2-adapter";

/**
 * Mock V2 context that records every registration the adapter performs.
 * Mirrors the V2 API surface: domains own their hooks, transforms are
 * editor-based, and events arrive through an async subscription.
 */
function createMockCtx() {
  const toolHooks = new Map<string, (event: unknown) => Promise<void> | void>();
  const sessionHooks = new Map<string, (event: unknown) => Promise<void> | void>();
  const transforms: Array<(editor: unknown) => void> = [];
  const disposed: string[] = [];
  const eventHandlers: Array<(event: { type: string; properties?: Record<string, unknown> }) => void> = [];

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
  } as unknown as V2Context;

  return { ctx, toolHooks, sessionHooks, transforms, disposed, eventHandlers };
}

describe("V2 adapter — hook registration", () => {
  test("registers tool, session, and event hooks on their domains", async () => {
    const mock = createMockCtx();
    const cleanup = await setupV2(mock.ctx, {
      handlers: {
        "tool.execute.before": async () => {},
        "tool.execute.after": async () => {},
        "experimental.chat.system.transform": async () => {},
        "experimental.chat.messages.transform": async () => {},
        "chat.params": async () => {},
        "chat.message": async () => {},
        "experimental.session.compacting": async () => {},
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

  test("omits hooks that have no V1 handler", async () => {
    const mock = createMockCtx();
    await setupV2(mock.ctx, {
      handlers: { "tool.execute.before": async () => {} },
      toolMap: {},
      dispose: async () => {},
    });

    expect(mock.toolHooks.has("execute.before")).toBe(true);
    expect(mock.toolHooks.has("execute.after")).toBe(false);
    expect(mock.sessionHooks.has("context")).toBe(false);
    expect(mock.sessionHooks.has("prompt")).toBe(false);
  });

  test("registers every tool from the V1 tool map through tool.transform", async () => {
    const mock = createMockCtx();
    const added: Array<{ name: string }> = [];
    await setupV2(mock.ctx, {
      handlers: {},
      toolMap: {
        memory_search: tool({
          description: "Search memory",
          args: { query: tool.schema.string().describe("keywords") },
          async execute() { return "ok"; },
        }),
      },
      dispose: async () => {},
    });

    const editor = { add: (t: { name: string }) => { added.push(t); } };
    mock.transforms[0]?.(editor);

    expect(added.length).toBe(1);
    expect(added[0]?.name).toBe("memory_search");
  });
});

describe("V2 adapter — hook bridging", () => {
  test("tool.execute.before writes mutated args back onto the event", async () => {
    const mock = createMockCtx();
    await setupV2(mock.ctx, {
      handlers: {
        "tool.execute.before": async (_input: unknown, output: { args: unknown }) => {
          output.args = { filePath: "/mutated" };
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = { tool: "read", sessionID: "ses_1", id: "call_1", input: { filePath: "/orig" } };
    await mock.toolHooks.get("execute.before")?.(event);

    expect((event as { input: { filePath: string } }).input.filePath).toBe("/mutated");
  });

  test("tool.execute.after replaces the result with the mutated output", async () => {
    const mock = createMockCtx();
    await setupV2(mock.ctx, {
      handlers: {
        "tool.execute.after": async (_input: unknown, output: { output: string; title: string }) => {
          output.output = "compressed";
          output.title = "t";
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
      result: { output: "raw", title: "orig" },
    };
    await mock.toolHooks.get("execute.after")?.(event);

    const result = (event as { result: { output: string; title: string } }).result;
    expect(result.output).toBe("compressed");
    expect(result.title).toBe("t");
  });

  test("messages transform receives V1-shaped messages and injections are converted back to V2", async () => {
    const mock = createMockCtx();
    let seen: Array<{ info: { role?: string }; parts: Array<{ type: string; text?: string }> }> = [];
    await setupV2(mock.ctx, {
      handlers: {
        "experimental.chat.messages.transform": async (_input: unknown, output: { messages: typeof seen }) => {
          seen = output.messages;
          // Simulate the memory injection the real handler performs.
          output.messages.splice(output.messages.length - 1, 0, {
            info: { role: "user" },
            parts: [{ type: "text", text: "[memory] injected" }],
          });
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = {
      sessionID: "ses_1",
      system: [{ type: "text", text: "sys" }],
      messages: [
        { id: "m1", role: "user", content: [{ type: "text", text: "hello" }] },
        { id: "m2", role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
      options: {},
    };
    await mock.sessionHooks.get("context")?.(event);

    // Handler saw the V1 shape.
    expect(seen[0]?.info.role).toBe("user");
    expect(seen[0]?.parts[0]?.text).toBe("hello");

    // Event was written back in the V2 shape, including the injection.
    const messages = (event as { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }).messages;
    expect(messages.length).toBe(3);
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content[0]?.text).toBe("[memory] injected");
    expect(messages[2]?.role).toBe("assistant");
  });

  test("system transform appends new system parts", async () => {
    const mock = createMockCtx();
    await setupV2(mock.ctx, {
      handlers: {
        "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
          output.system.push("extra rule");
        },
      },
      toolMap: {},
      dispose: async () => {},
    });

    const event = {
      sessionID: "ses_1",
      system: [{ type: "text", text: "base" }],
      messages: [],
      options: {},
    };
    await mock.sessionHooks.get("context")?.(event);

    const system = (event as { system: Array<{ type: string; text?: string }> }).system;
    expect(system.length).toBe(2);
    expect(system[1]?.text).toBe("extra rule");
  });
});

describe("V2 adapter — tool conversion", () => {
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

    const converted = toV2Tool("memory_search", def);
    const schema = converted.input as {
      type: string;
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required: string[];
    };

    expect(schema.type).toBe("object");
    expect(schema.properties.query?.type).toBe("string");
    expect(schema.properties.query?.description).toBe("Concise keywords");
    expect(schema.properties.limit?.type).toBe("integer");
    expect(schema.properties.mode?.enum).toEqual(["search", "fetch"]);
    expect(schema.required).toEqual(["query"]);
  });

  test("wraps a string tool result into V2 content", async () => {
    const def = tool({
      description: "Echo",
      args: { value: tool.schema.string() },
      async execute(args) { return `echo:${args.value}`; },
    });

    const converted = toV2Tool("echo", def);
    const result = await converted.execute({ value: "hi" }, {});
    expect(result.content).toBe("echo:hi");
  });
});
