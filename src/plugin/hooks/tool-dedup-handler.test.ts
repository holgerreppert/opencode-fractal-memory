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

    const after = handler["tool.execute.after"];
    if (after) await after({ tool: "grep", sessionID: "s", callID: "c", args: { pattern: "unique" }, output: "x".repeat(30), metadata: {} });

    // Same tool+args again → served from cache in tool.after.
    const output2 = { tool: "grep", sessionID: "s", callID: "c2", args: { pattern: "unique" }, output: "something else", metadata: {} as Record<string, unknown> };
    await after!(output2);
    expect(output2.output).toBe("x".repeat(30));
    expect(output2.metadata.deduped).toBe(true);
    expect(output2.metadata.dedupSource).toBe("tool-dedup-cache");
  });

  test("does not serve when turn protection active", async () => {
    const config = makeConfig({ toolDedup: { enabled: true, maxCacheEntries: 100, protectedTools: [], turnProtectionTurns: 3 } });
    const handler = createToolDedupHandler(config);

    const after = handler["tool.execute.after"];
    const before = handler["tool.execute.before"];
    if (after) await after({ tool: "grep", sessionID: "s", callID: "c", args: { pattern: "foo" }, output: "x".repeat(30), metadata: {} });

    // Advance turn counter by 2 — diff=2 < protection=3, so no serve.
    for (let i = 0; i < 2; i++) {
      if (before) await before();
    }

    const output2 = { output: "y".repeat(30), metadata: {} };
    await after!({ tool: "grep", sessionID: "s", callID: "c", args: { pattern: "foo" }, ...output2 });
    expect(output2.metadata.deduped).toBeUndefined();
    expect(output2.output).toBe("y".repeat(30));
  });

  test("skips bash tool", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);
    const after = handler["tool.execute.after"];
    const output = { tool: "bash", sessionID: "s", callID: "c2", args: { command: "ls" }, output: "some result", metadata: {} as Record<string, unknown> };
    await after!(output);
    expect(output.metadata.deduped).toBeUndefined();
  });

  test("skips tiny outputs when recording", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);
    const after = handler["tool.execute.after"];
    // Tiny output is not cached → no serve on repeat.
    if (after) await after({ tool: "grep", sessionID: "s", callID: "c", args: { pattern: "tiny" }, output: "short", metadata: {} });
    const output2 = { tool: "grep", sessionID: "s", callID: "c2", args: { pattern: "tiny" }, output: "short", metadata: {} as Record<string, unknown> };
    await after!(output2);
    expect(output2.metadata.deduped).toBeUndefined();
  });

  test("respects protectedTools", async () => {
    const config = makeConfig({ toolDedup: { enabled: true, maxCacheEntries: 100, protectedTools: ["grep"], turnProtectionTurns: 0 } });
    const handler = createToolDedupHandler(config);
    const after = handler["tool.execute.after"];
    if (after) await after({ tool: "grep", sessionID: "s", callID: "c", args: { pattern: "prot" }, output: "x".repeat(30), metadata: {} });
    const output2 = { output: "y".repeat(30), metadata: {} as Record<string, unknown> };
    await after!({ tool: "grep", sessionID: "s", callID: "c", args: { pattern: "prot" }, ...output2 });
    expect(output2.metadata.deduped).toBeUndefined();
  });
});
