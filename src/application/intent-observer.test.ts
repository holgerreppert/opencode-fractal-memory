import { describe, test, expect } from "bun:test";
import { extractIntentLine, captureRoundIntent, captureSessionIntent } from "./intent-observer";
import type { MemoryStore } from "../storage/sqlite";
import type { SessionApi } from "../plugin/session-api";
import type { SessionMessage } from "../plugin/messages";

function msg(role: string, text: string, id: string): SessionMessage {
  return { id, role, text, parts: [] };
}

interface StoredRow {
  turn: number;
  userMsgHash: string | null;
  rawText: string;
  messageId: string | null;
}

function fakeStore(opts: { count?: number; has?: boolean; injected?: string[] } = {}) {
  const stored: StoredRow[] = [];
  const bumped: Array<{ nodeIds: string[]; intent: string }> = [];
  const store = {
    async countIntentLines(_sessionId: string): Promise<number> {
      return opts.count ?? stored.length;
    },
    async hasIntentForMessage(_messageId: string): Promise<boolean> {
      return opts.has ?? false;
    },
    async logIntentLine(
      _sessionId: string,
      data: { turn: number; userMsgHash: string | null; rawText: string; source?: string; messageId?: string | null; partId?: string | null },
    ): Promise<void> {
      stored.push({
        turn: data.turn,
        userMsgHash: data.userMsgHash,
        rawText: data.rawText,
        messageId: data.messageId ?? null,
      });
    },
    async getInjectionNodeIds(_sessionId: string, _limit?: number): Promise<string[]> {
      return opts.injected ?? [];
    },
    async bumpIntentVector(nodeIds: string[], intent: string): Promise<number> {
      bumped.push({ nodeIds, intent });
      return nodeIds.length;
    },
  };
  return { store: store as unknown as MemoryStore, stored, bumped };
}

describe("extractIntentLine", () => {
  test("extracts a plain intent line", () => {
    expect(extractIntentLine("hello\nintent: debugging the reload 404\nbye")).toBe("debugging the reload 404");
  });

  test("is case-insensitive and trims", () => {
    expect(extractIntentLine("Intent:   planning the vector  ")).toBe("planning the vector");
  });

  test("returns null when missing or empty", () => {
    expect(extractIntentLine("no intent here")).toBeNull();
    expect(extractIntentLine("intent:   ")).toBeNull();
    expect(extractIntentLine("")).toBeNull();
  });

  test("truncates to 30 words", () => {
    const long = "intent: " + Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    const out = extractIntentLine(long)!;
    expect(out.split(/\s+/)).toHaveLength(30);
    expect(out.startsWith("w0")).toBe(true);
    expect(out.endsWith("w29")).toBe(true);
  });

  test("takes the first intent line", () => {
    expect(extractIntentLine("intent: first\nintent: second")).toBe("first");
  });
});

describe("captureRoundIntent", () => {
  test("captures the newest assistant intent line", async () => {
    const { store, stored } = fakeStore();
    const status = await captureRoundIntent(store, "ses_a", [
      msg("user", "please fix the reload 404", "m1"),
      msg("assistant", "intent: debugging the reload 404", "m2"),
      msg("user", "now check it after restart", "m3"),
      msg("assistant", "all green\nintent: verifying the replay fix after restart", "m4"),
    ]);
    expect(status).toContain("intent round 1");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.rawText).toBe("verifying the replay fix after restart");
    expect(stored[0]!.messageId).toBe("m4");
    expect(stored[0]!.turn).toBe(1);
  });

  test("hashes the last user message", async () => {
    const { store, stored } = fakeStore();
    await captureRoundIntent(store, "ses_a", [
      msg("user", "first question", "u1"),
      msg("assistant", "ok", "a1"),
      msg("user", "final question", "u2"),
      msg("assistant", "intent: researching the docs", "a2"),
    ]);
    expect(stored[0]!.userMsgHash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("turn comes from the persisted count", async () => {
    const { store, stored } = fakeStore({ count: 6 });
    await captureRoundIntent(store, "ses_a", [msg("assistant", "intent: planning the vector", "a1")]);
    expect(stored[0]!.turn).toBe(7);
  });

  test("skips when the message was already recorded", async () => {
    const { store, stored } = fakeStore({ has: true });
    const status = await captureRoundIntent(store, "ses_a", [
      msg("assistant", "intent: planning the vector", "a1"),
    ]);
    expect(status).toContain("duplicate");
    expect(stored).toHaveLength(0);
  });

  test("no-op when the round has no intent line", async () => {
    const { store, stored } = fakeStore();
    const status = await captureRoundIntent(store, "ses_a", [
      msg("user", "hi", "u1"),
      msg("assistant", "working on it", "a1"),
    ]);
    expect(status).toBe("no intent line in round");
    expect(stored).toHaveLength(0);
  });

  test("only scans the last five assistant messages", async () => {
    const { store, stored } = fakeStore();
    const messages = Array.from({ length: 6 }, (_, i) =>
      msg("assistant", i === 0 ? "intent: stale from round one" : "still working", `a${i}`),
    );
    const status = await captureRoundIntent(store, "ses_a", messages);
    expect(status).toBe("no intent line in round");
    expect(stored).toHaveLength(0);
  });

  test("stores an empty message id as null", async () => {
    const { store, stored } = fakeStore();
    await captureRoundIntent(store, "ses_a", [msg("assistant", "intent: researching docs", "")]);
    expect(stored[0]!.messageId).toBeNull();
  });

  test("attributes injected nodes to the classified intent on first capture", async () => {
    const { store, bumped } = fakeStore({ injected: ["n1", "n2", "n3"] });
    const status = await captureRoundIntent(store, "ses_a", [
      msg("assistant", "intent: debugging the reload 404", "a1"),
    ]);
    expect(status).toContain("intent round 1");
    expect(status).toContain("(+3 nodes → debug)");
    expect(bumped).toHaveLength(1);
    expect(bumped[0]!.nodeIds).toEqual(["n1", "n2", "n3"]);
    expect(bumped[0]!.intent).toBe("debug");
  });

  test("skips attribution when the session had no injections", async () => {
    const { store, bumped } = fakeStore({ injected: [] });
    const status = await captureRoundIntent(store, "ses_a", [
      msg("assistant", "intent: planning the vector", "a1"),
    ]);
    expect(status).toBe('intent round 1 q="planning the vector"');
    expect(bumped).toHaveLength(0);
  });

  test("does not attribute on a duplicate capture", async () => {
    const { store, bumped } = fakeStore({ has: true, injected: ["n1"] });
    const status = await captureRoundIntent(store, "ses_a", [
      msg("assistant", "intent: verifying the fix", "a1"),
    ]);
    expect(status).toContain("duplicate");
    expect(bumped).toHaveLength(0);
  });

  test("attribution failures never fail the capture", async () => {
    const { store, stored } = fakeStore();
    (store as unknown as { getInjectionNodeIds: () => Promise<string[]> }).getInjectionNodeIds = async () => {
      throw new Error("db gone");
    };
    const status = await captureRoundIntent(store, "ses_a", [
      msg("assistant", "intent: implementing the seam", "a1"),
    ]);
    expect(status).toBe('intent round 1 q="implementing the seam"');
    expect(stored).toHaveLength(1);
  });
});

describe("captureSessionIntent", () => {
  test("fetches messages through the session api", async () => {
    const { store, stored } = fakeStore();
    const client = {
      messages: async () => [msg("assistant", "intent: implementing the entrypoint", "a1")],
    } as unknown as SessionApi;
    const status = await captureSessionIntent(store, "ses_a", client);
    expect(status).toContain("intent round 1");
    expect(stored).toHaveLength(1);
  });

  test("refuses the unknown session id", async () => {
    const { store, stored } = fakeStore();
    const client = { messages: async () => [] } as unknown as SessionApi;
    expect(await captureSessionIntent(store, "unknown", client)).toBe("no session id");
    expect(stored).toHaveLength(0);
  });

  test("turns api failures into a status string", async () => {
    const { store } = fakeStore();
    const client = {
      messages: async () => {
        throw new Error("boom");
      },
    } as unknown as SessionApi;
    expect(await captureSessionIntent(store, "ses_a", client)).toContain("intent capture failed");
  });
});
