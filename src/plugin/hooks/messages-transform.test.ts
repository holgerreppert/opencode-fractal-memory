import { describe, expect, test } from "bun:test";
import { createMessagesTransformHandler } from "./messages-transform";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";

function makeConfig(overrides?: Record<string, unknown>): MemConfig {
  return {
    enabled: true,
    autoRetrieve: { enabled: true, topK: 3, minScore: 0.5, ollamaUrl: "", useOllama: false, useOnnx: false },
    memoryCompression: { enabled: false, minLevel: 1, targetLevel: 3, maintenanceInterval: 3600000, llmCompressOnAccess: false, llmCompressOnSet: false },
    outputCompression: { enabled: false, maxLines: 50, excludeCommands: [], alwaysFullOnFailure: false, relevanceTrimmingEnabled: false },
    sessionManagement: { enabled: false },
    embedding: { enabled: false, model: "all-MiniLM-L6-v2", dimension: 384 },
    errorPruning: { enabled: false, turns: 1, protectedTools: [] },
    toolDedup: { enabled: false, maxCacheEntries: 100, protectedTools: [], turnProtectionTurns: 2 },
    ...overrides,
  } as MemConfig;
}

function makeMockStore(): MemoryStore {
  return {
    drilldownQuery: async (_query: string, _limit: number) => [
      {
        node: {
          id: "node-1",
          label: "test:memory-1",
          content: "This is a test memory node with useful context information for testing purposes.",
          type: "note",
          importance: 0.8,
          usefulnessScore: 3,
        },
        score: 0.95,
      },
      {
        node: {
          id: "node-2",
          label: "test:memory-2",
          content: "This is another test memory node with additional context.",
          type: "fact",
          importance: 0.6,
          usefulnessScore: 2,
        },
        score: 0.85,
      },
    ],
  } as unknown as MemoryStore;
}

function makeEmptyStore(): MemoryStore {
  return {
    drilldownQuery: async () => [],
  } as unknown as MemoryStore;
}

describe("createMessagesTransformHandler", () => {
  test("returns empty object when autoRetrieve disabled", () => {
    const config = makeConfig({ autoRetrieve: { enabled: false } });
    const handler = createMessagesTransformHandler({} as MemoryStore, config);
    expect(Object.keys(handler)).toHaveLength(0);
  });

  test("injects memory context for user messages with context", async () => {
    const store = makeMockStore();
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config);

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me about test memory" }] },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      await transform({} as any, output);
    }

    // Should have injected a memory context message before the last user message
    expect(output.messages.length).toBe(4);
    const injected = output.messages[2]!;
    expect(injected.info?.role).toBe("user");
    expect(injected.parts[0]?.text).toContain("<memory_context>");
    expect(injected.parts[0]?.text).toContain("test:memory-1");
  });

  test("injected block invites explicit rating with its entry labels", async () => {
    const store = makeMockStore();
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config, { value: "ses-rate-invite" });

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me about test memory" }] },
      ],
    };

    const transform = handler["chat.messages.transform"]!;
    await transform({} as any, output);

    const injected = output.messages.find(m => m.parts[0]?.text?.includes("<memory_context>"));
    expect(injected).toBeDefined();
    expect(injected!.parts[0]!.text).toContain('learn(mode="rate"');
    expect(injected!.parts[0]!.text).toContain("test:memory-1");
  });

  test("skips injection when store returns no results", async () => {
    const store = makeEmptyStore();
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config);

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "hi" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "anything?" }] },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      await transform({} as any, output);
    }

    expect(output.messages.length).toBe(3);
  });

  test("skips injection for too few messages", async () => {
    const store = makeMockStore();
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config);

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "hello" }] },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      await transform({} as any, output);
    }

    expect(output.messages.length).toBe(2);
  });

  test("filters low-importance nodes in normal phase via autoInjection.minScore", async () => {
    const store = makeMockStore();
    const config = makeConfig({ autoInjection: { enabled: true, injectOn: "always", maxResults: 3, maxTokens: 2000, minScore: 0.7 } });
    const handler = createMessagesTransformHandler(store, config);

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me about test memory" }] },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      await transform({} as any, output);
    }

    // Only the 0.8 node passes the 0.7 gate; the 0.6 node is dropped
    const injected = output.messages.find(m => m.parts[0]?.text?.includes("<memory_context>"));
    expect(injected).toBeDefined();
    expect(injected!.parts[0]!.text).toContain("test:memory-1");
    expect(injected!.parts[0]!.text).not.toContain("test:memory-2");
  });

  test("dedups per session: a node injected once is not re-injected the same session", async () => {
    const store = makeMockStore();
    const config = makeConfig();
    const sessionId = { value: "ses-dedup" };
    const handler = createMessagesTransformHandler(store, config, sessionId);

    const makeOutput = () => ({
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me about test memory again" }] },
      ],
    });

    const transform = handler["chat.messages.transform"]!;

    // First turn: both nodes pass (minScore 0.05 default) → injected.
    const out1 = makeOutput();
    await transform({} as any, out1);
    expect(out1.messages.length).toBe(4);
    const injected1 = out1.messages[2]!;
    expect(injected1.parts[0]?.text).toContain("test:memory-1");

    // Second turn, same session: both nodes already seen → nothing injected.
    const out2 = makeOutput();
    await transform({} as any, out2);
    expect(out2.messages.length).toBe(3);
  });

  test("allows re-injection in a new session (dedup is per-session)", async () => {
    const store = makeMockStore();
    const config = makeConfig();
    const sessionId = { value: "ses-1" };
    const handler = createMessagesTransformHandler(store, config, sessionId);

    const makeOutput = () => ({
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me about test memory once more" }] },
      ],
    });

    const transform = handler["chat.messages.transform"]!;

    const out1 = makeOutput();
    await transform({} as any, out1);
    expect(out1.messages.length).toBe(4);

    // New session id → fresh dedup set → injects again.
    sessionId.value = "ses-2";
    const out2 = makeOutput();
    await transform({} as any, out2);
    expect(out2.messages.length).toBe(4);
  });

  test("excludes research-type nodes from auto-injection by default", async () => {
    const store = {
      drilldownQuery: async () => [
        {
          node: {
            id: "node-r",
            label: "research:big-synthesis",
            content: "Comprehensive research synthesis that matches keywords but not intent.",
            type: "research",
            importance: 0.95,
            usefulnessScore: 3,
          },
          score: 0.99,
        },
        {
          node: {
            id: "node-n",
            label: "fix:relevant-bug",
            content: "Relevant fix for the current task.",
            type: "fix",
            importance: 0.6,
            usefulnessScore: 2,
          },
          score: 0.85,
        },
      ],
    } as unknown as MemoryStore;
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config, { value: "ses-exclude" });

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "fix the memory bug now" }] },
      ],
    };

    const transform = handler["chat.messages.transform"]!;
    await transform({} as any, output);

    // High-importance research node is excluded by type; the fix node injects.
    const injected = output.messages.find(m => m.parts[0]?.text?.includes("<memory_context>"));
    expect(injected).toBeDefined();
    expect(injected!.parts[0]!.text).toContain("fix:relevant-bug");
    expect(injected!.parts[0]!.text).not.toContain("research:big-synthesis");
  });

  test("logs injectedTokens from the truncated block, not full node content", async () => {
    let captured: { injectedTokens: number } | null = null;
    const store = {
      drilldownQuery: async () => [
        {
          node: {
            id: "node-big",
            label: "note:big-node",
            content: "x".repeat(4000),
            type: "note",
            importance: 0.9,
            usefulnessScore: 3,
          },
          score: 0.95,
        },
      ],
      logInjectionMetrics: async (_sid: string, data: { injectedTokens: number }) => {
        captured = data;
      },
    } as unknown as MemoryStore;
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config, { value: "ses-tokens" });

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me about big node" }] },
      ],
    };

    const transform = handler["chat.messages.transform"]!;
    await transform({} as any, output);

    // Old formula reported 4000/4 = 1000t; the truncated ~300-char block is ~100t.
    expect(captured).not.toBeNull();
    expect(captured!.injectedTokens).toBeGreaterThan(0);
    expect(captured!.injectedTokens).toBeLessThan(200);
  });

  test("bumps usefulness when the agent drills into an injected node", async () => {
    const updates: Array<{ id: string; u: Record<string, unknown> }> = [];
    const store = {
      drilldownQuery: async () => [
        {
          node: {
            id: "node-1",
            label: "test:memory-1",
            content: "Useful context the agent will drill into.",
            type: "note",
            importance: 0.8,
            usefulnessScore: 0.8,
            timesHelpful: 3,
          },
          score: 0.95,
        },
      ],
      getNode: async (id: string) => ({
        id,
        label: "test:memory-1",
        content: "Useful context the agent will drill into.",
        type: "note",
        importance: 0.8,
        usefulnessScore: 0.8,
        timesHelpful: 3,
      }),
      updateNode: async (id: string, u: Record<string, unknown>) => {
        updates.push({ id, u });
      },
      logInjectionMetrics: async () => {},
    } as unknown as MemoryStore;
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config, { value: "ses-judge-use" });
    const transform = handler["chat.messages.transform"]!;

    // Turn 1: inject.
    const out1 = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me about test memory" }] },
      ],
    };
    await transform({} as any, out1);
    expect(out1.messages.length).toBe(4);
    expect(updates).toHaveLength(0);

    // Turn 2: agent drills into the injected node via a memory tool.
    const out2 = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "tool_use", name: "memory_get", input: { id: "node-1" } }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "tell me more about that node" }] },
      ],
    };
    await transform({} as any, out2);

    // Judged used: +0.5 usefulness, timesHelpful +1. Dedup blocks re-injection.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("node-1");
    expect(updates[0]!.u.usefulnessScore).toBeCloseTo(1.3);
    expect(updates[0]!.u.timesHelpful).toBe(4);
    expect(out2.messages.length).toBe(4);
  });

  test("decays usefulness for injections ignored past the grace window", async () => {
    const updates: Array<{ id: string; u: Record<string, unknown> }> = [];
    const store = {
      drilldownQuery: async () => [
        {
          node: {
            id: "node-9",
            label: "test:ignored-9",
            content: "Context the agent never touches.",
            type: "note",
            importance: 0.8,
            usefulnessScore: 0.8,
            timesHelpful: 0,
          },
          score: 0.9,
        },
      ],
      getNode: async (id: string) => ({
        id,
        label: "test:ignored-9",
        content: "Context the agent never touches.",
        type: "note",
        importance: 0.8,
        usefulnessScore: 0.8,
        timesHelpful: 0,
      }),
      updateNode: async (id: string, u: Record<string, unknown>) => {
        updates.push({ id, u });
      },
      logInjectionMetrics: async () => {},
    } as unknown as MemoryStore;
    const config = makeConfig();
    const handler = createMessagesTransformHandler(store, config, { value: "ses-judge-ignore" });
    const transform = handler["chat.messages.transform"]!;

    const makeOutput = (n: number) => ({
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "first message" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "response" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: `unrelated question number ${n} here` }] },
      ],
    });

    await transform({} as any, makeOutput(1));
    await transform({} as any, makeOutput(2));
    await transform({} as any, makeOutput(3));
    expect(updates).toHaveLength(0);

    // 4th turn: 3 turns past injection → gentle decay, judged once.
    await transform({} as any, makeOutput(4));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("node-9");
    expect(updates[0]!.u.usefulnessScore).toBeCloseTo(0.55);
    expect(updates[0]!.u.timesHelpful).toBeUndefined();
  });
});
