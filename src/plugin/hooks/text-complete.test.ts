import { describe, test, expect } from "bun:test";
import { extractIntentLine, createTextCompleteHandler } from "./text-complete";
import type { MemoryStore } from "../../storage/sqlite";

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

describe("text.complete intent catch", () => {
  function makeStore(captured: Array<{ sid: string; d: Record<string, unknown> }>) {
    return {
      async logIntentLine(sid: string, d: Record<string, unknown>) {
        captured.push({ sid, d });
      },
      async logToolCall() { /* empty */ },
    } as unknown as MemoryStore;
  }

  test("persists declared intent with turn + user hash", async () => {
    const captured: Array<{ sid: string; d: Record<string, unknown> }> = [];
    const handler = createTextCompleteHandler(
      makeStore(captured),
      { value: "ses-1" },
      { value: "fix the 404" },
    );
    const output = { text: "done.\nintent: debugging the reload 404" };
    await handler["text.complete"]!({}, output);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.sid).toBe("ses-1");
    expect(captured[0]!.d).toMatchObject({ turn: 1, rawText: "debugging the reload 404", source: "agent" });
    expect(typeof captured[0]!.d["userMsgHash"]).toBe("string");
  });

  test("missing line persists nothing and never throws", async () => {
    const captured: Array<{ sid: string; d: Record<string, unknown> }> = [];
    const handler = createTextCompleteHandler(makeStore(captured), { value: "ses-1" }, { value: "" });
    const output = { text: "just a normal response" };
    await handler["text.complete"]!({}, output);
    expect(captured).toHaveLength(0);
  });

  test("works without store (log only)", async () => {
    const handler = createTextCompleteHandler(undefined, { value: "ses-1" }, { value: "" });
    const output = { text: "intent: planning" };
    await handler["text.complete"]!({}, output);
    // no throw = pass
  });

  test("strip behavior intact alongside catch", async () => {
    const captured: Array<{ sid: string; d: Record<string, unknown> }> = [];
    const handler = createTextCompleteHandler(makeStore(captured), { value: "ses-1" }, { value: "" });
    const output = { text: "see [message abc] now\nintent: verifying tests" };
    await handler["text.complete"]!({}, output);
    expect(output.text).not.toContain("[message abc]");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.d["rawText"]).toBe("verifying tests");
  });
});
