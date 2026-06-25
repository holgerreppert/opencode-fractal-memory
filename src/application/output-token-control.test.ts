import { describe, expect, test } from "bun:test";
import {
  getInjectionText,
  shouldExclude,
  type OutputTokenControlConfig,
} from "./output-token-control";

function makeConfig(overrides: Partial<OutputTokenControlConfig> = {}): OutputTokenControlConfig {
  return {
    enabled: true,
    mode: "adaptive",
    strategy: "concise",
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
    normalStrategy: "concise",
    warnStrategy: "sentence_limit",
    aggressiveStrategy: "sentence_limit",
    criticalStrategy: "char_limit",
    normalPrompt: "",
    warnPrompt: "",
    aggressivePrompt: "",
    criticalPrompt: "",
    excludePatterns: [],
    ...overrides,
  };
}

describe("getInjectionText", () => {
  test("returns null when disabled", () => {
    const result = getInjectionText(makeConfig({ enabled: false }), "hello");
    expect(result).toBeNull();
  });

  test("returns null when mode is off", () => {
    const result = getInjectionText(makeConfig({ mode: "off" }), "hello");
    expect(result).toBeNull();
  });

  test("concise strategy at normal level includes sentence limit", () => {
    const result = getInjectionText(makeConfig(), "hello", "normal");
    expect(result).toContain("5 sentences");
    expect(result).toContain("concise");
  });

  test("sentence_limit strategy at warn level", () => {
    const result = getInjectionText(
      makeConfig({ warnStrategy: "sentence_limit", warnSentences: 3 }),
      "hello",
      "warn",
    );
    expect(result).toContain("at most 3 sentences");
  });

  test("aggressive level uses 1 sentence", () => {
    const result = getInjectionText(
      makeConfig({ aggressiveStrategy: "sentence_limit", aggressiveSentences: 1 }),
      "hello",
      "aggressive",
    );
    expect(result).toContain("at most 1 sentence");
  });

  test("critical level uses char_limit", () => {
    const result = getInjectionText(
      makeConfig({ criticalStrategy: "char_limit", criticalSentences: 1 }),
      "hello",
      "critical",
    );
    expect(result).toContain("characters");
  });

  test("always-on mode always uses normal level", () => {
    const result = getInjectionText(makeConfig({ mode: "always-on" }), "hello");
    expect(result).toContain("5 sentences");
  });

  test("custom strategy returns customPrompt", () => {
    const result = getInjectionText(
      makeConfig({
        normalStrategy: "custom",
        normalPrompt: "Answer in exactly 2 sentences.",
        maxSentences: 5,
      }),
      "hello",
      "normal",
    );
    expect(result).toBe("Answer in exactly 2 sentences.");
  });

  test("bullet_only strategy includes bullet points instruction", () => {
    const result = getInjectionText(
      makeConfig({ normalStrategy: "bullet_only" }),
      "hello",
      "normal",
    );
    expect(result).toContain("bullet points");
    expect(result).toContain("No paragraphs");
  });

  test("concise strategy also includes skip-intros instruction", () => {
    const result = getInjectionText(makeConfig(), "hello", "normal");
    expect(result).toContain("Skip introductions");
    expect(result).toContain("rambling");
  });
});

describe("shouldExclude", () => {
  test("returns false when no patterns", () => {
    expect(shouldExclude(makeConfig(), "explain how X works")).toBe(false);
  });

  test("returns true when message matches pattern", () => {
    const config = makeConfig({ excludePatterns: ["^explain", "^describe"] });
    expect(shouldExclude(config, "explain how X works")).toBe(true);
    expect(shouldExclude(config, "describe the architecture")).toBe(true);
  });

  test("returns false when message does not match", () => {
    const config = makeConfig({ excludePatterns: ["^explain"] });
    expect(shouldExclude(config, "run the test")).toBe(false);
  });

  test("handles invalid regex gracefully", () => {
    const config = makeConfig({ excludePatterns: ["[invalid"] });
    expect(shouldExclude(config, "anything")).toBe(false);
  });
});

describe("config defaults", () => {
  test("mode defaults to adaptive", () => {
    const result = getInjectionText(
      makeConfig({ mode: "adaptive" }),
      "hello",
      "normal",
    );
    expect(result).not.toBeNull();
  });

  test("different levels produce different texts", () => {
    const cfg = makeConfig();
    const normal = getInjectionText(cfg, "hello", "normal");
    const critical = getInjectionText(cfg, "hello", "critical");
    expect(normal).not.toBe(critical);
  });
});
