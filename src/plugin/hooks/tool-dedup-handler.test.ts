import { describe, expect, test } from "bun:test";
import { createToolDedupHandler } from "./tool-dedup";
import type { MemConfig } from "../../infrastructure/config/config";

function makeConfig(overrides?: Record<string, unknown>): MemConfig {
  return {
    enabled: true,
    autoRetrieve: { enabled: false, topK: 3, minScore: 0.5, ollamaUrl: "", useOllama: false, useOnnx: false },
    memoryCompression: { enabled: false, minLevel: 1, targetLevel: 3, maintenanceInterval: 3600000, llmCompressOnAccess: false, llmCompressOnSet: false },
    outputCompression: { enabled: false, maxLines: 50, excludeCommands: [], alwaysFullOnFailure: false, relevanceTrimmingEnabled: false },
    sessionManagement: { enabled: false },
    embedding: { enabled: false, model: "all-MiniLM-L6-v2", dimension: 384 },
    errorPruning: { enabled: false, turns: 1, protectedTools: [] },
    toolDedup: { enabled: true, maxCacheEntries: 100, protectedTools: [], turnProtectionTurns: 0 },
    ...overrides,
  } as MemConfig;
}

describe("createToolDedupHandler", () => {
  test("returns empty object when disabled", () => {
    const config = makeConfig({ toolDedup: { enabled: false } });
    const handler = createToolDedupHandler(config);
    expect(Object.keys(handler)).toHaveLength(0);
  });

  test("tool.after records output for caching", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);

    const after = handler["tool.after"];
    if (after) await after({ tool: "grep", args: { pattern: "unique" } } as any, { output: "x".repeat(30), metadata: {} });

    // Same tool+args again → served from cache in tool.after.
    const output2 = { output: "something else", metadata: {} };
    if (after) await after({ tool: "grep", args: { pattern: "unique" } } as any, output2);
    expect(output2.output).toBe("x".repeat(30));
    expect((output2.metadata as Record<string, unknown>).deduped).toBe(true);
    expect((output2.metadata as Record<string, unknown>).dedupSource).toBe("tool-dedup-cache");
  });

  test("does not serve when turn protection active", async () => {
    const config = makeConfig({ toolDedup: { turnProtectionTurns: 3 } });
    const handler = createToolDedupHandler(config);

    const after = handler["tool.after"];
    const before = handler["tool.before"];
    if (after) await after({ tool: "grep", args: { pattern: "foo" } } as any, { output: "x".repeat(30), metadata: {} });

    // Advance turn counter by 2 — diff=2 < protection=3, so no serve.
    for (let i = 0; i < 2; i++) {
      if (before) await before();
    }

    const output2 = { output: "y".repeat(30), metadata: {} };
    if (after) await after({ tool: "grep", args: { pattern: "foo" } } as any, output2);
    expect((output2.metadata as Record<string, unknown>).deduped).toBeUndefined();
    expect(output2.output).toBe("y".repeat(30));
  });

  test("skips bash tool", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);
    const after = handler["tool.after"];
    const output = { output: "some result", metadata: {} };
    if (after) await after({ tool: "bash", args: { command: "ls" } } as any, output);
    expect((output.metadata as Record<string, unknown>).deduped).toBeUndefined();
  });

  test("skips tiny outputs when recording", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);
    const after = handler["tool.after"];
    // Tiny output is not cached → no serve on repeat.
    if (after) await after({ tool: "grep", args: { pattern: "tiny" } } as any, { output: "short", metadata: {} });
    const output2 = { output: "short", metadata: {} };
    if (after) await after({ tool: "grep", args: { pattern: "tiny" } } as any, output2);
    expect((output2.metadata as Record<string, unknown>).deduped).toBeUndefined();
  });

  test("respects protectedTools", async () => {
    const config = makeConfig({ toolDedup: { protectedTools: ["grep"] } });
    const handler = createToolDedupHandler(config);
    const after = handler["tool.after"];
    if (after) await after({ tool: "grep", args: { pattern: "prot" } } as any, { output: "x".repeat(30), metadata: {} });
    const output2 = { output: "y".repeat(30), metadata: {} };
    if (after) await after({ tool: "grep", args: { pattern: "prot" } } as any, output2);
    expect((output2.metadata as Record<string, unknown>).deduped).toBeUndefined();
  });
});
