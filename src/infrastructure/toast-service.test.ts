import { describe, expect, test } from "bun:test";
import { ToastService } from "./toast-service";

// Simulates the SDK's generated Tui class: showToast reads `this._client` —
// calling the method detached (extracted into a variable) loses `this` and
// throws. Regression test for the "undefined is not an object (evaluating
// 'this._client')" bug.
class FakeTui {
  _client: { shown: Array<unknown> };
  constructor(client: { shown: Array<unknown> }) {
    this._client = client;
  }
  async showToast(options: { body: unknown }) {
    this._client.shown.push(options.body);
  }
}

describe("ToastService", () => {
  test("calls showToast as a method (keeps this binding) — no this._client crash", async () => {
    const shown: Array<unknown> = [];
    const tui = new FakeTui({ shown });
    const service = new ToastService({ tui }, { enabled: true, mode: "toast" });
    const ok = await service.showToast({ title: "t", message: "hello" });
    expect(ok).toBe(true);
    expect(shown).toHaveLength(1);
  });

  test("no-op when tui.showToast missing", async () => {
    const service = new ToastService({}, { enabled: true, mode: "toast" });
    const ok = await service.showToast({ message: "hello" });
    expect(ok).toBe(false);
  });

  test("no-op when disabled", async () => {
    const shown: Array<unknown> = [];
    const tui = new FakeTui({ shown });
    const service = new ToastService({ tui }, { enabled: false, mode: "toast" });
    const ok = await service.showToast({ message: "hello" });
    expect(ok).toBe(false);
    expect(shown).toHaveLength(0);
  });

  test("truncates long messages at 600 chars", async () => {
    const shown: Array<unknown> = [];
    const tui = new FakeTui({ shown });
    const service = new ToastService({ tui }, { enabled: true, mode: "toast" });
    await service.showToast({ message: "x".repeat(1000) });
    const body = shown[0] as { message: string };
    expect(body.message.length).toBe(600);
    expect(body.message.endsWith("...")).toBe(true);
  });

  test("notifyCompression in toast mode builds DCP-style message", async () => {
    const shown: Array<unknown> = [];
    const tui = new FakeTui({ shown });
    const service = new ToastService({ tui }, { enabled: true, mode: "toast" });
    const ok = await service.notifyCompression({
      sessionId: "ses-test",
      messageCount: 15,
      topic: "debugging-graph-hook",
      registryLabel: "contexthistory:index:ses-test",
    });
    expect(ok).toBe(true);
    const body = shown[0] as { title: string; message: string };
    expect(body.title).toBe("archivecontext: Compression");
    expect(body.message).toContain("15 message(s) archived");
    expect(body.message).toContain("debugging-graph-hook");
    expect(body.message).toContain("contexthistory:index:ses-test");
  });

  test("does not crash when showToast throws (catches and logs)", async () => {
    const tui = {
      showToast: async () => {
        throw new Error("boom");
      },
    };
    const service = new ToastService({ tui }, { enabled: true, mode: "toast" });
    const ok = await service.showToast({ message: "hello" });
    expect(ok).toBe(false);
  });

  test("notifyCompression in chat mode injects ignored session message (DCP default)", async () => {
    const prompts: Array<{ path: { id: string }; body: { noReply?: boolean; parts?: Array<{ type: string; text: string; ignored?: boolean }> } }> = [];
    const service = new ToastService(
      { session: { prompt: async (opts: { path: { id: string }; body: { noReply?: boolean; parts?: Array<{ type: string; text: string; ignored?: boolean }> } }) => { prompts.push(opts); } } },
      { enabled: true, mode: "chat" },
    );
    const ok = await service.notifyCompression({
      sessionId: "ses-test",
      messageCount: 3,
      topic: "t1",
      registryLabel: "contexthistory:index:ses-test",
      agent: "main",
    });
    expect(ok).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.path.id).toBe("ses-test");
    expect(prompts[0]!.body.noReply).toBe(true);
    expect(prompts[0]!.body.agent).toBe("main");
    const part = prompts[0]!.body.parts![0]!;
    expect(part.type).toBe("text");
    expect(part.ignored).toBe(true);
    expect(part.text).toContain("3 message(s) archived");
  });

  // Regression: the SDK's session.prompt reads `this._client` — it must be
  // called as a method on the session instance, not detached.
  class FakeSession {
    _client: { prompts: Array<{ path: { id: string }; body: unknown }> };
    constructor(client: { prompts: Array<{ path: { id: string }; body: unknown }> }) {
      this._client = client;
    }
    async prompt(options: { path: { id: string }; body: unknown }) {
      this._client.prompts.push(options);
    }
  }

  test("calls session.prompt as a method (keeps this binding) — no this._client crash", async () => {
    const prompts: Array<{ path: { id: string }; body: unknown }> = [];
    const session = new FakeSession({ prompts });
    const service = new ToastService({ session }, { enabled: true, mode: "chat" });
    const ok = await service.sendChatNotification("ses-test", "hello");
    expect(ok).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.path.id).toBe("ses-test");
  });

  test("notifyCompression in off mode does nothing", async () => {
    const prompts: Array<unknown> = [];
    const shown: Array<unknown> = [];
    const service = new ToastService(
      {
        tui: { showToast: async (opts: { body: unknown }) => { shown.push(opts.body); } },
        session: { prompt: async (opts: unknown) => { prompts.push(opts); } },
      },
      { enabled: true, mode: "off" },
    );
    const ok = await service.notifyCompression({ sessionId: "ses-test", messageCount: 1 });
    expect(ok).toBe(false);
    expect(prompts).toHaveLength(0);
    expect(shown).toHaveLength(0);
  });
});