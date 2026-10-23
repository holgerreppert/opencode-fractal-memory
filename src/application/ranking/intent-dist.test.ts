import { describe, test, expect } from "bun:test";
import { INTENT_ORDER, classifyIntent, intentDistribution } from "./intent-dist";

describe("classifyIntent", () => {
  test("maps real corpus lines to their intents", () => {
    expect(classifyIntent("debugging the reload 404").intent).toBe("debug");
    expect(classifyIntent("implementing dual-shape V1+V2 plugin entrypoint directly").intent).toBe("implement");
    expect(classifyIntent("fetching official V1→V2 migration docs").intent).toBe("research");
    expect(classifyIntent("planning GitLab volume backup for server 192.168.2.7").intent).toBe("plan");
    expect(classifyIntent("verifying the replay fix is live after restart").intent).toBe("verify");
    expect(classifyIntent("storing GitLab backup knowledge into project hub").intent).toBe("reflect");
    expect(classifyIntent("answering whether refnr job search is possible").intent).toBe("research");
    expect(classifyIntent("writing mocked captcha-outcome Playwright tests").intent).toBe("implement");
  });

  test("classifies synthetic lines for decide and understand", () => {
    expect(classifyIntent("choosing between sqlite-vec and hnsw index strategies").intent).toBe("decide");
    expect(classifyIntent("explaining why the plugin cache path wins over config node_modules").intent).toBe("understand");
  });

  test("falls back to implement when nothing matches", () => {
    const c = classifyIntent("xyzzy");
    expect(c.intent).toBe("implement");
    expect(c.confidence).toBe(0);
  });

  test("ties break toward the earlier match position", () => {
    // "verifying" at index 0 beats "fix" later → verify despite debug's 404/fix.
    expect(classifyIntent("verifying the replay fix").intent).toBe("verify");
  });

  test("confidence is the winning share of the total score", () => {
    const c = classifyIntent("verifying the replay fix");
    expect(c.confidence).toBeCloseTo(0.5, 2);
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.confidence).toBeLessThanOrEqual(1);
  });

  test("scores cover the whole 8-intent taxonomy", () => {
    const { scores } = classifyIntent("anything");
    expect(Object.keys(scores).sort()).toEqual([...INTENT_ORDER].sort());
  });
});

describe("intentDistribution", () => {
  test("counts and normalizes to a proper distribution", () => {
    const d = intentDistribution([
      "debugging the reload 404",
      "implementing the entrypoint",
      "debugging the crash",
      "fetching docs",
    ]);
    expect(d.total).toBe(4);
    expect(d.counts.debug).toBe(2);
    expect(d.counts.implement).toBe(1);
    expect(d.counts.research).toBe(1);
    expect(d.distribution.debug).toBeCloseTo(0.5, 5);
    const sum = INTENT_ORDER.reduce((acc, i) => acc + d.distribution[i], 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  test("handles an empty corpus", () => {
    const d = intentDistribution([]);
    expect(d.total).toBe(0);
    expect(d.lowConfidence).toBe(0);
    expect(d.distribution.debug).toBe(0);
  });

  test("counts sub-0.5 confidence rows as low-confidence", () => {
    const d = intentDistribution(["verifying the replay fix", "plain work line"]);
    // First row ties verify/debug (0.5, not low); second has no signal (0).
    expect(d.lowConfidence).toBe(1);
  });
});
