import { describe, expect, test, beforeEach } from "bun:test";
import { createContextCompressTool } from "./context-compress";
import { createSqliteMemoryStore } from "../storage/sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCompressState, forgetCompressSession } from "../application/context-compression/state";
import type { MemConfig } from "../infrastructure/config/config";

function makeConfig(): MemConfig {
  return {
    contextCompression: { enabled: true, permission: "compress", maxHistoryNodesPerSession: 30, historyTtlDays: 30 },
    injectionVisibility: { enabled: true, markers: true, digest: true },
  } as unknown as MemConfig;
}

function makeClient(sessionId: string) {
  return {
    session: {
      messages: async () => [
        {
          info: { id: "msg-1", role: "user", time: { created: Date.now() - 5000 } },
          parts: [{ type: "text", text: "Can you explain how the ranking module works?" }],
        },
        {
          info: { id: "msg-2", role: "assistant", time: { created: Date.now() - 3000 } },
          parts: [
            { type: "text", text: "The ranking module uses a feature-weighted linear model with semantic, bm25, quality, confidence, and usefulness features. It replaced RRF fusion." },
            { type: "tool_use", name: "read", input: { filePath: "src/application/ranking/weights.ts" } },
            { type: "tool_result", text: "weights defined here", isError: false },
          ],
        },
        {
          info: { id: "msg-3", role: "user", time: { created: Date.now() - 1000 } },
          parts: [{ type: "text", text: "And how do the weights interact?" }],
        },
      ],
    },
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

      expect(result).toContain("Compressed 1 message(s)");
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
});