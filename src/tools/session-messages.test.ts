import { describe, expect, test } from "bun:test";
import { createSessionMessagesTool } from "./session-messages";
import { estimateMessageTokens, partTypeChars, realMessageTokens } from "../application/context-compression/message-size";

function makeClient(messages: unknown[]) {
  return {
    session: {
      messages: async () => ({ data: messages }),
    },
  };
}

function makeMsg(id: string, role: string, parts: unknown[]) {
  return { info: { id, role }, parts };
}

describe("message-size helpers", () => {
  test("estimateMessageTokens sums text + reasoning + tool output + file", () => {
    const msg = makeMsg("m1", "assistant", [
      { type: "text", text: "hello ".repeat(100) },
      { type: "reasoning", text: "think ".repeat(50) },
      { type: "tool", tool: "bash", state: { status: "completed", output: "out ".repeat(200), input: { command: "ls" } } },
      { type: "file", source: { text: { value: "file content ".repeat(30) } } },
    ]);
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
    // tool output dominates (200 vs 100/50/30 chunks)
    const byType = partTypeChars(msg);
    expect(byType.tool!).toBeGreaterThan(byType.text!);
  });

  test("realMessageTokens returns output+reasoning, null when absent", () => {
    expect(realMessageTokens(makeMsg("m1", "assistant", []))).toBeNull();
    expect(
      realMessageTokens({ info: { tokens: { input: 1, output: 400, reasoning: 100, cache: { read: 0, write: 0 } } }, parts: [] }),
    ).toBe(500);
  });

  test("estimateMessageTokens returns 0 for messages with no text payloads", () => {
    const msg = makeMsg("m1", "user", [{ type: "step-start" }, { type: "patch", files: ["a.ts"] }]);
    expect(estimateMessageTokens(msg)).toBe(0);
  });
});

describe("createSessionMessagesTool", () => {
  test("lists messages sorted by size desc", async () => {
    const client = makeClient([
      makeMsg("small", "user", [{ type: "text", text: "hi" }]),
      makeMsg("big", "assistant", [{ type: "tool", tool: "bash", state: { status: "completed", output: "x ".repeat(3000) } }]),
      makeMsg("med", "assistant", [{ type: "text", text: "word ".repeat(500) }]),
    ]);
    const tool = createSessionMessagesTool(client);
    const result = (await tool.execute({ limit: 10 }, { sessionID: "ses-1" } as never)) as string;
    const bigIdx = result.indexOf("[message big]");
    const medIdx = result.indexOf("[message med]");
    const smallIdx = result.indexOf("[message small]");
    expect(bigIdx).toBeGreaterThanOrEqual(0);
    expect(medIdx).toBeGreaterThan(bigIdx);
    expect(smallIdx).toBeGreaterThan(medIdx);
  });

  test("pattern filters by content across tool outputs", async () => {
    const client = makeClient([
      makeMsg("m1", "assistant", [{ type: "tool", tool: "bash", state: { status: "completed", output: "unique-secret-value here" } }]),
      makeMsg("m2", "user", [{ type: "text", text: "nothing matching" }]),
    ]);
    const tool = createSessionMessagesTool(client);
    const result = (await tool.execute({ limit: 10, pattern: "unique-secret-value" }, { sessionID: "ses-1" } as never)) as string;
    expect(result).toContain("[message m1]");
    expect(result).not.toContain("[message m2]");
  });

  test("minTokens filters small messages", async () => {
    const client = makeClient([
      makeMsg("small", "user", [{ type: "text", text: "hi" }]),
      makeMsg("big", "assistant", [{ type: "text", text: "word ".repeat(2000) }]),
    ]);
    const tool = createSessionMessagesTool(client);
    const result = (await tool.execute({ limit: 10, minTokens: 1000 }, { sessionID: "ses-1" } as never)) as string;
    expect(result).toContain("[message big]");
    expect(result).not.toContain("[message small]");
  });

  test("returns error message when SDK client is unavailable", async () => {
    const tool = createSessionMessagesTool({});
    const result = (await tool.execute({}, { sessionID: "ses-1" } as never)) as string;
    expect(result).toContain("not available");
  });

  test("returns no-match message when nothing matches", async () => {
    const client = makeClient([makeMsg("m1", "user", [{ type: "text", text: "hi" }])]);
    const tool = createSessionMessagesTool(client);
    const result = (await tool.execute({ limit: 10, pattern: "zzz-no-match" }, { sessionID: "ses-1" } as never)) as string;
    expect(result).toContain("No messages match");
  });
});