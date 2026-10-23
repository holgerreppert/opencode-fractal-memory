import { describe, expect, test } from "bun:test";
import { createSessionApi } from "./session-api";

function rawAssistant(id: string, model?: { providerID: string; id: string }) {
  return {
    type: "assistant",
    id,
    ...(model ? { model } : {}),
    content: [{ type: "text", text: "ok" }],
  };
}

describe("SessionApi.lastModel", () => {
  test("returns the model of the newest assistant message", async () => {
    const api = createSessionApi({
      session: {
        context: async () => [
          rawAssistant("m1", { providerID: "anthropic", id: "claude-3" }),
          rawAssistant("m2", { providerID: "openai", id: "gpt-5" }),
        ],
      },
    });
    expect(await api.lastModel("ses_abc")).toEqual({ providerID: "openai", id: "gpt-5" });
  });

  test("skips newer messages without a model (e.g. user turns)", async () => {
    const api = createSessionApi({
      session: {
        context: async () => [
          rawAssistant("m1", { providerID: "anthropic", id: "claude-4" }),
          { type: "user", id: "m2", content: [{ type: "text", text: "hello" }] },
        ],
      },
    });
    expect(await api.lastModel("ses_abc")).toEqual({ providerID: "anthropic", id: "claude-4" });
  });

  test("splits provider/id on the first slash so slashed model ids survive", async () => {
    const api = createSessionApi({
      session: {
        context: async () => [
          rawAssistant("m1", { providerID: "openrouter", id: "anthropic/claude-3.5-sonnet" }),
        ],
      },
    });
    expect(await api.lastModel("ses_abc")).toEqual({
      providerID: "openrouter",
      id: "anthropic/claude-3.5-sonnet",
    });
  });

  test("skips malformed model strings (empty provider or id) and keeps scanning", async () => {
    const api = createSessionApi({
      session: {
        context: async () => [
          rawAssistant("m1", { providerID: "anthropic", id: "claude-4" }),
          rawAssistant("m2", { providerID: "", id: "orphan" }),
          rawAssistant("m3", { providerID: "p", id: "" }),
        ],
      },
    });
    expect(await api.lastModel("ses_abc")).toEqual({ providerID: "anthropic", id: "claude-4" });
  });

  test("returns undefined when no message records a model", async () => {
    const api = createSessionApi({
      session: { context: async () => [rawAssistant("m1")] },
    });
    expect(await api.lastModel("ses_abc")).toBeUndefined();
  });

  test("returns undefined without calling context for an unusable session id", async () => {
    let contextCalls = 0;
    const api = createSessionApi({
      session: {
        context: async () => {
          contextCalls++;
          return [rawAssistant("m1", { providerID: "anthropic", id: "claude-4" })];
        },
      },
    });
    expect(await api.lastModel("short-id")).toBeUndefined();
    expect(contextCalls).toBe(0);
  });
});

describe("SessionApi.generate", () => {
  test("returns the generated text", async () => {
    const api = createSessionApi({
      session: {},
      generate: { text: async ({ prompt }) => ({ text: `echo:${prompt}` }) },
    });
    expect(await api.generate({ model: { providerID: "p", id: "m" }, prompt: "hi" })).toBe("echo:hi");
  });

  test("returns undefined when the runtime has no generate domain", async () => {
    const api = createSessionApi({ session: {} });
    expect(await api.generate({ model: { providerID: "p", id: "m" }, prompt: "hi" })).toBeUndefined();
  });
});
