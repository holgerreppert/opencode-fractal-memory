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
});
