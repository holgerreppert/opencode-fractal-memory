import { describe, expect, test, beforeEach } from "bun:test";
import {
  buildInjectionDigest,
  drainInjectionLedger,
  getInjectionVisibilityConfig,
  injectionMarker,
  peekInjectionLedger,
  recordInjection,
  resetInjectionLedger,
} from "./injection-visibility";
import type { MemConfig } from "../infrastructure/config/config";

function makeConfig(overrides?: Partial<MemConfig["injectionVisibility"]>): MemConfig {
  return {
    injectionVisibility: { enabled: true, markers: true, digest: true, ...overrides },
  } as MemConfig;
}

beforeEach(() => {
  resetInjectionLedger();
});

describe("getInjectionVisibilityConfig", () => {
  test("defaults to enabled when config section absent", () => {
    const cfg = getInjectionVisibilityConfig({} as MemConfig);
    expect(cfg.enabled).toBe(true);
    expect(cfg.markers).toBe(true);
    expect(cfg.digest).toBe(true);
  });

  test("honors explicit config", () => {
    const cfg = getInjectionVisibilityConfig(makeConfig({ enabled: false, markers: false }));
    expect(cfg.enabled).toBe(false);
    expect(cfg.markers).toBe(false);
  });
});

describe("injectionMarker", () => {
  test("builds marker string when enabled", () => {
    const marker = injectionMarker(makeConfig(), "seed-rules", "3 rule(s) injected");
    expect(marker).toBe("[memory-plugin:seed-rules] 3 rule(s) injected");
  });

  test("returns empty when markers disabled", () => {
    expect(injectionMarker(makeConfig({ markers: false }), "seed-rules", "x")).toBe("");
  });

  test("returns empty when whole feature disabled", () => {
    expect(injectionMarker(makeConfig({ enabled: false }), "seed-rules", "x")).toBe("");
  });
});

describe("injection ledger", () => {
  test("record + drain returns records and clears ledger", () => {
    const config = makeConfig();
    recordInjection(config, "compression", "100→20 chars");
    recordInjection(config, "graph-context", "skeleton on src/foo.ts");
    expect(peekInjectionLedger()).toHaveLength(2);
    const drained = drainInjectionLedger();
    expect(drained).toHaveLength(2);
    expect(peekInjectionLedger()).toHaveLength(0);
  });

  test("does not record when digest disabled", () => {
    recordInjection(makeConfig({ digest: false }), "compression", "100→20 chars");
    expect(peekInjectionLedger()).toHaveLength(0);
  });

  test("does not record when feature disabled", () => {
    recordInjection(makeConfig({ enabled: false }), "compression", "100→20 chars");
    expect(peekInjectionLedger()).toHaveLength(0);
  });
});

describe("buildInjectionDigest", () => {
  test("returns empty for empty ledger", () => {
    expect(buildInjectionDigest([])).toBe("");
  });

  test("groups by feature and dedups identical details", () => {
    const digest = buildInjectionDigest([
      { feature: "compression", detail: "100→20 chars", timestamp: 1 },
      { feature: "compression", detail: "100→20 chars", timestamp: 2 },
      { feature: "seed-rules", detail: "3 rule(s)", timestamp: 3 },
    ]);
    expect(digest).toContain("[memory-plugin:digest] injections this turn:");
    expect(digest).toContain("- compression: 100→20 chars");
    expect(digest).toContain("- seed-rules: 3 rule(s)");
  });
});
