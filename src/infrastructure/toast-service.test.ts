import { describe, expect, test } from "bun:test";
import { ToastService } from "./toast-service";
import type { SessionApi } from "../plugin/session-api";

/** A session API that records the messages the service adds. */
function makeSession() {
  const messages: Array<{ sessionID: string; text: string }> = [];
  const session: SessionApi = {
    messages: async () => [],
    prompt: async () => undefined,
    synthetic: async (input) => {
      messages.push(input);
    },
    generate: async () => undefined,
    lastModel: async () => undefined,
  };
  return { session, messages };
}

describe("ToastService", () => {
  test("no-op when disabled", async () => {
    const { session, messages } = makeSession();
    const service = new ToastService(session, { enabled: false, mode: "chat" });
    const ok = await service.notifyCompression({ sessionId: "ses-test", messageCount: 3, topic: "t1" });
    expect(ok).toBe(false);
    expect(messages).toHaveLength(0);
  });

  test("notifyCompression builds the DCP-style message", async () => {
    const { session, messages } = makeSession();
    const service = new ToastService(session, { enabled: true, mode: "chat" });
    const ok = await service.notifyCompression({
      sessionId: "ses-test",
      messageCount: 15,
      topic: "debugging-graph-hook",
      registryLabel: "contexthistory:index:ses-test",
    });
    expect(ok).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.sessionID).toBe("ses-test");
    expect(messages[0]!.text).toContain("15 archived");
    expect(messages[0]!.text).toContain("debugging-graph-hook");
    expect(messages[0]!.text).toContain("contexthistory:index:ses-test");
  });

  test("buildCompressionMessage renders token math, progress bar, and entries", () => {
    const { session } = makeSession();
    const service = new ToastService(session, { enabled: true, mode: "chat" });
    const msg = service.buildCompressionMessage({
      sessionId: "ses-test",
      messageCount: 3,
      topic: "debugging-graph-hook",
      registryLabel: "contexthistory:index:ses-test",
      entries: [
        { msgRef: "m0001", description: "graph hook failing", nodeLabel: "contexthistory:ses-test:1" },
        { msgRef: "m0002", description: "WASM OOM in batch worker", nodeLabel: "contexthistory:ses-test:1" },
      ],
      removedChars: 100_000,
      summaryChars: 400,
      totalMessages: 12,
    });
    expect(msg).toContain("3 archived");
    expect(msg).toContain("−25.0k tok"); // 100k chars / 4
    expect(msg).toContain("saved 24.9k");
    expect(msg).toContain("│"); // progress bar
    expect(msg).toContain("3/12 messages processed");
    expect(msg).toContain('[m0001] "graph hook failing" → contexthistory:ses-test:1');
    expect(msg).toContain('[m0002] "WASM OOM in batch worker" → contexthistory:ses-test:1');
  });

  test("buildCompressionMessage handles a single message (singular) and no extras", () => {
    const { session } = makeSession();
    const service = new ToastService(session, { enabled: true, mode: "chat" });
    const msg = service.buildCompressionMessage({ sessionId: "ses-test", messageCount: 1 });
    expect(msg).toContain("1 archived");
    expect(msg).not.toContain("Topic:");
    expect(msg).not.toContain("│");
    expect(msg).toContain("Originals preserved");
  });

  test("notifyCompression adds a session message (DCP default)", async () => {
    const { session, messages } = makeSession();
    const service = new ToastService(session, { enabled: true, mode: "chat" });
    const ok = await service.notifyCompression({
      sessionId: "ses-test",
      messageCount: 3,
      topic: "t1",
      registryLabel: "contexthistory:index:ses-test",
      agent: "main",
    });
    expect(ok).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.sessionID).toBe("ses-test");
    expect(messages[0]!.text).toContain("3 archived");
  });

  test("toast mode falls back to a session message", async () => {
    const { session, messages } = makeSession();
    const service = new ToastService(session, { enabled: true, mode: "toast" });
    const ok = await service.notifyCompression({ sessionId: "ses-test", messageCount: 2, topic: "t1" });
    expect(ok).toBe(true);
    expect(messages).toHaveLength(1);
  });
});
