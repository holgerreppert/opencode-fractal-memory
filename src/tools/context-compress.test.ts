import { describe, expect, test, beforeEach } from "bun:test";
import { createContextCompressTool } from "./context-compress";
import { createSqliteMemoryStore } from "../storage/sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCompressState, forgetCompressSession } from "../application/context-compression/state";
import { ToastService } from "../infrastructure/toast-service";
import type { MemConfig } from "../infrastructure/config/config";

function makeConfig(): MemConfig {
  return {
    contextCompression: { enabled: true, permission: "compress", maxHistoryNodesPerSession: 30, historyTtlDays: 30, nudgePressureThreshold: 0.6, notificationMode: "chat" },
    injectionVisibility: { enabled: true, markers: true, digest: true },
  } as unknown as MemConfig;
}

function makeClient(sessionId: string) {
  return {
    messages: async () => [
        {
          id: "msg-1", role: "user", time: { created: Date.now() - 5000 },
          parts: [{ type: "text", text: "Can you explain how the ranking module works?" }],
        },
        {
          id: "msg-2", role: "assistant", time: { created: Date.now() - 3000 },
          parts: [
            { type: "text", text: "The ranking module uses a feature-weighted linear model with semantic, bm25, quality, confidence, and usefulness features. It replaced RRF fusion." },
            { type: "tool_use", name: "read", input: { filePath: "src/application/ranking/weights.ts" } },
            { type: "tool_result", text: "weights defined here", isError: false },
          ],
        },
        {
          id: "msg-3", role: "user", time: { created: Date.now() - 1000 },
          parts: [{ type: "text", text: "And how do the weights interact?" }],
        },
      ],
    prompt: async () => undefined,
    synthetic: async () => undefined,
    generate: async () => undefined,
    lastModel: async () => undefined,
  };
}

const SESSION = "ses-tool-test";

beforeEach(() => {
  forgetCompressSession(SESSION);
});

describe("createContextCompressTool", () => {
  test("archives messages as contexthistory nodes + registry", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    try {
      const tool = createContextCompressTool(store, makeClient(SESSION), makeConfig());
      const result = await tool.execute(
        {
          topic: "ranking module explanation",
          content: JSON.stringify([
            { messageId: "msg-2", topic: "ranking module internals", description: "explains linear model features" },
          ]),
        },
        { sessionID: SESSION } as never,
      );

      expect(result).toContain("Archived 1 message(s)");
      expect(result).toContain("contexthistory:index:ses-tool-test");

      const state = getCompressState(SESSION);
      expect(state.blocks.size).toBe(1);
      const entry = state.blocks.get("msg-2")!;
      expect(entry.blockId).toBe("m0001");
      expect(entry.summary).toBe("explains linear model features");

      // History node exists with archived content
      const history = await store.getNodeByLabel("project", entry.label);
      expect(history.content).toContain("feature-weighted linear model");
      expect(history.content).toContain("--- slice m0001 ---");
      expect(history.sticky).toBe(true);
      expect(history.type).toBe("contexthistory");

      // Registry node exists with entries
      const registry = await store.getNodeByLabel("project", "contexthistory:index:ses-tool-test");
      const parsed = JSON.parse(registry.content) as { entries: Array<{ ref: string; msgId: string; status: string; summary: string }> };
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]!.ref).toBe("m0001");
      expect(parsed.entries[0]!.msgId).toBe("msg-2");
      expect(parsed.entries[0]!.status).toBe("archived");
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("skips unknown and already-compressed message ids", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    try {
      const tool = createContextCompressTool(store, makeClient(SESSION), makeConfig());
      await tool.execute(
        { topic: "t", content: JSON.stringify([{ messageId: "msg-1", topic: "t1", description: "d1" }]) },
        { sessionID: SESSION } as never,
      );
      const result = await tool.execute(
        { topic: "t", content: JSON.stringify([
          { messageId: "msg-1", topic: "t1", description: "d1 again" },
          { messageId: "unknown-msg", topic: "t2", description: "d2" },
        ]) },
        { sessionID: SESSION } as never,
      );
      expect(result).toContain("Skipped");
      expect(result).toContain("msg-1 (already compressed)");
      expect(result).toContain("unknown-msg (unknown)");
      expect(getCompressState(SESSION).blocks.size).toBe(1);
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns disabled message when config disabled", async () => {
    const store = {} as never;
    const config = { contextCompression: { enabled: false } } as unknown as MemConfig;
    const tool = createContextCompressTool(store, {}, config);
    const result = await tool.execute({ topic: "t", content: "[]" }, { sessionID: SESSION } as never);
    expect(result).toContain("disabled");
  });

  test("fires toast notification after successful compression (toast mode)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    const shown: Array<{ sessionID: string; text: string }> = [];
    const client = {
      ...makeClient(SESSION),
      synthetic: async (opts: { sessionID: string; text: string }) => { shown.push(opts); },
    };
    const toast = new ToastService(client, { enabled: true, mode: "toast" });
    try {
      const tool = createContextCompressTool(store, client, makeConfig(), toast);
      const result = await tool.execute(
        {
          topic: "ranking module explanation",
          content: JSON.stringify([
            { messageId: "msg-2", topic: "ranking module internals", description: "explains linear model features" },
          ]),
        },
        { sessionID: SESSION } as never,
      );
      expect(result).toContain("Archived 1 message(s)");
      expect(shown).toHaveLength(1);
      expect(shown[0]!.text).toContain("1 archived");
      expect(shown[0]!.text).toContain("contexthistory:index:ses-tool-test");
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("sends chat notification (DCP-style ignored message) by default", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    const prompts: Array<{ sessionID: string; text: string }> = [];
    const client = {
      ...makeClient(SESSION),
      synthetic: async (opts: { sessionID: string; text: string }) => { prompts.push(opts); },
    };
    const toast = new ToastService(client, { enabled: true, mode: "chat" });
    try {
      const tool = createContextCompressTool(store, client, makeConfig(), toast);
      await tool.execute(
        { topic: "t", content: JSON.stringify([{ messageId: "msg-2", topic: "t1", description: "d1" }]) },
        { sessionID: SESSION, agent: "main" } as never,
      );
      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.sessionID).toBe(SESSION);
      expect(prompts[0]!.text).toContain("context");
      expect(prompts[0]!.text).toContain("archived");
      expect(prompts[0]!.text).toContain("1 archived");
      expect(prompts[0]!.text).toContain("saved");
      expect(prompts[0]!.text).toContain("contexthistory:index:ses-tool-test");
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("no toast when toast service disabled", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    const shown: Array<{ title?: string; message: string; variant?: string }> = [];
    const prompts: Array<unknown> = [];
    const client = {
      ...makeClient(SESSION),
      prompt: async (opts: unknown) => { prompts.push(opts); },
    };
    const toast = new ToastService(
      client,
      { enabled: false },
    );
    try {
      const tool = createContextCompressTool(store, client, makeConfig(), toast);
      await tool.execute(
        { topic: "t", content: JSON.stringify([{ messageId: "msg-2", topic: "t1", description: "d1" }]) },
        { sessionID: SESSION } as never,
      );
      expect(shown).toHaveLength(0);
      expect(prompts).toHaveLength(0);
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("allFlagged archives only messages above the token floor, biggest first", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    const big = "word ".repeat(7000); // 7000 words → ≥7000 tok under BOTH estimate modes (exact tokenizer ~1 tok/word, fallback 1.5×) → HIGH (>5000)
    const client = {
      messages: async () => [
          { id: "msg-big", role: "user", parts: [{ type: "text", text: big }] },
          { id: "msg-small", role: "user", parts: [{ type: "text", text: "tiny" }] },
    ],
      };
    try {
      const tool = createContextCompressTool(store, client, makeConfig());
      const result = await tool.execute(
        { topic: "auto-batch", allFlagged: true },
        { sessionID: SESSION } as never,
      );
      expect(result).toContain("Archived 1 message(s)");
      const state = getCompressState(SESSION);
      expect(state.blocks.has("msg-big")).toBe(true);
      expect(state.blocks.has("msg-small")).toBe(false);
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("allFlagged returns nothing-to-archive when no message crosses the floor", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    const client = {
      messages: async () => [
          { id: "msg-small", role: "user", parts: [{ type: "text", text: "tiny" }] },
    ],
      };
    try {
      const tool = createContextCompressTool(store, client, makeConfig());
      const result = await tool.execute(
        { topic: "auto-batch", allFlagged: true },
        { sessionID: SESSION } as never,
      );
      expect(result).toContain("Nothing to archive");
      expect(getCompressState(SESSION).blocks.size).toBe(0);
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("allFlagged uses real tokens when available (info.tokens)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    const client = {
      messages: async () => [
          {
            id: "msg-real", role: "assistant", tokens: { output: 6000, reasoning: 1000 },
            parts: [{ type: "text", text: "short" }],
          },
    ],
      };
    try {
      const tool = createContextCompressTool(store, client, makeConfig());
      const result = await tool.execute(
        { topic: "auto-batch", allFlagged: true },
        { sessionID: SESSION } as never,
      );
      expect(result).toContain("Archived 1 message(s)");
      expect(getCompressState(SESSION).blocks.has("msg-real")).toBe(true);
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("delete=true permanently removes messages — no history node, no registry", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    try {
      const tool = createContextCompressTool(store, makeClient(SESSION), makeConfig());
      const result = await tool.execute(
        {
          topic: "noise removal",
          delete: true,
          content: JSON.stringify([
            { messageId: "msg-2", topic: "empty tool output", description: "redundant ls listing" },
          ]),
        },
        { sessionID: SESSION } as never,
      );

      expect(result).toContain("Deleted 1 message(s)");
      expect(result).toContain("PERMANENTLY REMOVED");
      expect(result).not.toContain("Archived");

      const state = getCompressState(SESSION);
      expect(state.blocks.size).toBe(1);
      const entry = state.blocks.get("msg-2")!;
      expect(entry.deleted).toBe(true);
      expect(entry.nodeId).toBe("");
      expect(entry.label).toBe("");

      // No history node should exist
      const history = await store.getNodeByLabel("project", "").catch(() => null);
      expect(history).toBeNull();
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("delete=false archives messages (default behavior)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    try {
      const tool = createContextCompressTool(store, makeClient(SESSION), makeConfig());
      const result = await tool.execute(
        {
          topic: "test archive",
          delete: false,
          content: JSON.stringify([
            { messageId: "msg-2", topic: "t", description: "d" },
          ]),
        },
        { sessionID: SESSION } as never,
      );

      expect(result).toContain("Archived 1 message(s)");
      expect(result).not.toContain("Deleted");

      const entry = getCompressState(SESSION).blocks.get("msg-2")!;
      expect(entry.deleted).toBe(false);
      expect(entry.label).toContain("contexthistory");
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("allFlagged always archives, never deletes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-compress-"));
    const dbPath = path.join(tmp, "memory.db");
    const store = createSqliteMemoryStore(tmp, dbPath);
    const big = "word ".repeat(7000);
    const client = {
      messages: async () => [
          { id: "msg-big", role: "user", parts: [{ type: "text", text: big }] },
    ],
      };
    try {
      const tool = createContextCompressTool(store, client, makeConfig());
      const result = await tool.execute(
        { topic: "auto-batch", allFlagged: true, delete: true },
        { sessionID: SESSION } as never,
      );
      // allFlagged should archive even when delete=true is passed
      expect(result).toContain("Archived 1 message(s)");
      const entry = getCompressState(SESSION).blocks.get("msg-big")!;
      expect(entry.deleted).toBe(false);
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});