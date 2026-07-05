import type { MemConfig } from "../../infrastructure/config/config";
import { describe, expect, test } from "bun:test";
import { createOutputTokenControlHandler } from "./output-token-control";

describe("createOutputTokenControlHandler", () => {
  const baseConfig = {
    outputTokenControl: {
      enabled: true,
      mode: "adaptive" as const,
      strategy: "concise" as const,
      maxSentences: 5,
      maxChars: 0,
      customPrompt: "",
      warnThreshold: 0.7,
      aggressiveThreshold: 0.85,
      criticalThreshold: 0.95,
      normalSentences: 5,
      warnSentences: 3,
      aggressiveSentences: 1,
      criticalSentences: 1,
      normalStrategy: "concise" as const,
      warnStrategy: "sentence_limit" as const,
      aggressiveStrategy: "sentence_limit" as const,
      criticalStrategy: "char_limit" as const,
      normalPrompt: "",
      warnPrompt: "",
      aggressivePrompt: "",
      criticalPrompt: "",
      excludePatterns: [],
    },
    adaptivePressure: { enabled: false, warnThreshold: 0.7, aggressiveThreshold: 0.85, criticalThreshold: 0.95 },
  } as unknown as MemConfig;

  test("injects rule into system array at position 1", async () => {
    const handler = createOutputTokenControlHandler(baseConfig);
    const output = { system: ["static prompt content"] };
    await handler["system.transform"]!({ args: { userMessage: "hello" }, sessionID: "test-1" }, output);
    expect(output.system.length).toBe(2);
    expect(output.system[1]).toContain("system_reminder");
    expect(output.system[1]).toContain("5 sentences");
  });

  test("does not inject when config is not present", () => {
    const handler = createOutputTokenControlHandler({} as unknown as MemConfig);
    expect(handler["system.transform"]).toBeUndefined();
  });

  test("rule is wrapped in system_reminder tag", async () => {
    const handler = createOutputTokenControlHandler(baseConfig);
    const output = { system: ["first"] };
    await handler["system.transform"]!({ args: { userMessage: "hello" }, sessionID: "test-2" }, output);
    expect(output.system[1]).toMatch(/<system_reminder type="suggestion">/);
    expect(output.system[1]).toContain("</system_reminder>");
  });

  test("appends to empty system array", async () => {
    const handler = createOutputTokenControlHandler(baseConfig);
    const output = { system: [] };
    await handler["system.transform"]!({ args: { userMessage: "hello" }, sessionID: "test-3" }, output);
    expect(output.system.length).toBe(1);
    expect(output.system[0]).toContain("system_reminder");
  });
});
