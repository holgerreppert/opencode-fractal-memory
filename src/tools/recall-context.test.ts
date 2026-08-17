import type { MemoryStore } from "../domain/ports/MemoryStore";
import { describe, expect, test } from "bun:test";
import { MemoryRecallContext } from "./recall-context";

function makeStore(nodes: Record<string, unknown>[] = []) {
  
  return {
    async listNodes(_scope: "all" | "global" | "project") {
      return nodes;
    },
    async searchByEmbedding(_query: number[], _limit?: number, _options?: Record<string, unknown>) {
      return nodes.filter(n => n.type === "contexthistory").slice(0, _limit ?? 5);
    },
    getNode: async (id: string) => nodes.find(n => n.id === id),
  } as unknown as MemoryStore;
}

function makeNode(overrides: Record<string, unknown> = {}) {
  const id = `node-${++idCounter}`;
  const createdAt = overrides.createdAt != null ? new Date(overrides.createdAt) : new Date();
  return {
    id,
    scope: "project",
    label: overrides.label ?? `contexthistory:ses_${id}:${Date.now()}`,
    content: overrides.content ?? "User asked about X\nAssistant answered Y\n[tool: read]\n[result: ok]",
    type: overrides.type ?? "contexthistory",
    level: 0,
    importance: 3.0,
    createdAt,
    metadata: overrides.metadata ?? { customType: "contexthistory", sessionId: "ses_test" },
  };
}

let idCounter = 0;

describe("MemoryRecallContext", () => {
  test("returns empty message when no contexthistory nodes exist", async () => {
    const store = makeStore([]);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({});
    expect(result).toContain("No archived context found");
  });

  test("returns most recent contexthistory nodes by default", async () => {
    const nodes = [
      makeNode({ createdAt: Date.now() - 1000, label: "contexthistory:old" }),
      makeNode({ createdAt: Date.now(), label: "contexthistory:new" }),
    ];
    const store = makeStore(nodes);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({});
    expect(result).toContain("## Stored Context Recall");
    expect(result).toContain("contexthistory:new");
  });

  test("default limit is 5", async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode({ createdAt: Date.now() - i * 1000 }));
    const store = makeStore(nodes);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({});
    const matches = result.match(/Session:/g);
    expect(matches?.length).toBe(5);
  });

  test("respects custom limit", async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode({ createdAt: Date.now() - i * 1000 }));
    const store = makeStore(nodes);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({ limit: 2 });
    const matches = result.match(/Session:/g);
    expect(matches?.length).toBe(2);
  });

  test("filters by sessionId matching label prefix", async () => {
    const nodes = [
      makeNode({ label: "contexthistory:ses_abc:123", metadata: { customType: "contexthistory", sessionId: "ses_abc" } }),
      makeNode({ label: "contexthistory:ses_xyz:456", metadata: { customType: "contexthistory", sessionId: "ses_xyz" } }),
    ];
    const store = makeStore(nodes);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({ sessionId: "ses_abc" });
    expect(result).toContain("ses_abc");
    expect(result).not.toContain("ses_xyz");
  });

  test("filters by sessionId matching metadata", async () => {
    const nodes = [
      makeNode({ label: "contexthistory:other:123", metadata: { customType: "contexthistory", sessionId: "ses_target" } }),
      makeNode({ label: "contexthistory:other:456", metadata: { customType: "contexthistory", sessionId: "ses_other" } }),
    ];
    const store = makeStore(nodes);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({ sessionId: "ses_target" });
    expect(result).toContain("ses_target");
    expect(result).not.toContain("ses_other");
  });

  test("returns session-not-found message for unknown sessionId", async () => {
    const store = makeStore([]);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({ sessionId: "ses_nonexistent" });
    expect(result).toContain('No archived context found for session "ses_nonexistent"');
  });

  test("uses semantic search when query is provided", async () => {
    const matching = makeNode({ content: "authentication module with JWT tokens" });
    const store = makeStore([matching]);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({ query: "JWT authentication" });
    expect(result).toContain("## Stored Context Recall");
  });

  test("shows truncated content indicator when content exceeds 2000 chars", async () => {
    const longContent = "x".repeat(2500);
    const node = makeNode({ content: longContent });
    const store = makeStore([node]);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({});
    expect(result).toContain("content truncated");
    expect(result).toContain("2500 total chars");
  });

  test("displays session label from metadata", async () => {
    const node = makeNode({ metadata: { customType: "contexthistory", sessionId: "my-session-id" } });
    const store = makeStore([node]);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({});
    expect(result).toContain("my-session-id");
  });

  test("includes tip about memory(mode=search) type:contexthistory", async () => {
    const node = makeNode();
    const store = makeStore([node]);
    const tool = MemoryRecallContext(store);
    const result = await tool.execute({});
    expect(result).toContain("memory(mode=\"search\", query=\"type:contexthistory");
  });
});