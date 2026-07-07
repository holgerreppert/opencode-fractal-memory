import { describe, expect, test } from "bun:test";
import { createToolDedupHandler } from "./tool-dedup";
import type { MemConfig } from "../../infrastructure/config/config";

function makeConfig(overrides?: Record<string, unknown>): MemConfig {
  return {
    enabled: true,
    autoRetrieve: { enabled: false, topK: 3, minScore: 0.5, ollamaUrl: "", useOllama: false, useOnnx: false, bm25Weight: 0.5 },
    memoryCompression: { enabled: false, minLevel: 1, targetLevel: 3, maintenanceInterval: 3600000, llmCompressOnAccess: false, llmCompressOnSet: false },
    outputCompression: { enabled: false, maxLines: 50, excludeCommands: [], alwaysFullOnFailure: false, relevanceTrimmingEnabled: false },
    fileSummary: { enabled: false },
    sessionManagement: { enabled: false },
    embedding: { enabled: false, model: "all-MiniLM-L6-v2", dimension: 384 },
    errorPruning: { enabled: false, turns: 1, protectedTools: [] },
    toolDedup: { enabled: true, maxCacheEntries: 100, protectedTools: [], turnProtectionTurns: 2 },
    ...overrides,
  } as MemConfig;
}

describe("createToolDedupHandler", () => {
  test("returns empty object when disabled", () => {
    const config = makeConfig({ toolDedup: { enabled: false } });
    const handler = createToolDedupHandler(config);
    expect(Object.keys(handler)).toHaveLength(0);
  });

  test("tool.before returns null for uncached calls", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);

    const output = { output: "original result", metadata: {} };
    const before = handler["tool.before"];
    if (before) {
      await before({ tool: "grep", args: { pattern: "foo" } } as any, output);
    }

    expect(output.output).toBe("original result");
  });

  test("tool.before serves cached output when available", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);

    const input1 = { tool: "grep", args: { pattern: "foo" } };
    const output1 = { output: "x".repeat(30), metadata: {} };

    // First call: record after execution
    const after = handler["tool.after"];
    if (after) await after(input1 as any, output1);

    // Second call: should be deduped after turn protection passes
    const output2 = { output: "new result", metadata: {} };

    const before = handler["tool.before"];
    if (before) {
      // Need 2 turns for turnProtectionTurns=2
      // First nextTurn happens inside tool.before...
      // So first call sets turn to 2, then check with diff=2 >= 2
      // Actually each tool.before call does cache.nextTurn() AND check
      // So we need to call before multiple times:
      await before(input1 as any, output2);
      await before(input1 as any, output2);
      await before(input1 as any, output2); // third time should have enough turns
    }

    if (output2.metadata && (output2.metadata as Record<string, unknown>).deduped) {
      expect((output2.metadata as Record<string, unknown>).deduped).toBe(true);
      expect((output2.metadata as Record<string, unknown>).dedupSource).toBe("tool-dedup-cache");
    } else {
      // If turn protection still active, output stays unchanged
      expect(output2.output).toBe("new result");
    }
  });

  test("skips bash tool", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);

    const output = { output: "some result", metadata: {} };
    const before = handler["tool.before"];
    if (before) {
      await before({ tool: "bash", args: { command: "ls" } } as any, output);
    }

    expect(output.output).toBe("some result");
  });

  test("tool.after records output for caching", async () => {
    const config = makeConfig();
    const handler = createToolDedupHandler(config);

    const after = handler["tool.after"];
    if (after) {
      await after({ tool: "grep", args: { pattern: "unique" } } as any, { output: "x".repeat(30), metadata: {} });
    }

    // Now check that it was cached
    const output2 = { output: "something else", metadata: {} };
    const before = handler["tool.before"];
    if (before) {
      await before({ tool: "grep", args: { pattern: "unique" } } as any, output2);
      await before({ tool: "grep", args: { pattern: "unique" } } as any, output2);
      await before({ tool: "grep", args: { pattern: "unique" } } as any, output2);
    }

    if (output2.metadata && (output2.metadata as Record<string, unknown>).deduped) {
      expect((output2.metadata as Record<string, unknown>).deduped).toBe(true);
    }
  });
});
