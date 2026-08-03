import { describe, expect, test } from "bun:test";
import { createErrorPruneHandler } from "./error-prune";
import type { MemConfig } from "../../infrastructure/config/config";

function makeConfig(overrides?: Record<string, unknown>): MemConfig {
  return {
    enabled: true,
    autoRetrieve: { enabled: false, topK: 3, minScore: 0.5, ollamaUrl: "", useOllama: false, useOnnx: false },
    memoryCompression: { enabled: false, minLevel: 1, targetLevel: 3, maintenanceInterval: 3600000, llmCompressOnAccess: false, llmCompressOnSet: false },
    outputCompression: { enabled: false, maxLines: 50, excludeCommands: [], alwaysFullOnFailure: false, relevanceTrimmingEnabled: false },
    sessionManagement: { enabled: false },
    embedding: { enabled: false, model: "all-MiniLM-L6-v2", dimension: 384 },
    errorPruning: { enabled: true, turns: 1, protectedTools: ["read", "write"] },
    toolDedup: { enabled: false, maxCacheEntries: 100, protectedTools: [], turnProtectionTurns: 2 },
    ...overrides,
  } as MemConfig;
}

function makeToolPart(name: string, status: string, input: Record<string, unknown>) {
  return {
    type: "tool_use" as const,
    name,
    state: { status, input },
  };
}

describe("createErrorPruneHandler", () => {
  test("returns empty object when disabled", () => {
    const config = makeConfig({ errorPruning: { enabled: false } });
    const handler = createErrorPruneHandler(config);
    expect(Object.keys(handler)).toHaveLength(0);
  });

  test("prunes errored tool call inputs", async () => {
    const config = makeConfig();
    const handler = createErrorPruneHandler(config);

    // Simulate a tool.before call (increments turn counter)
    const before = handler["tool.before"];
    if (before) await before({} as any);

    // Build a messages.transform call with an errored tool part
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hello" }],
        },
        {
          info: { role: "assistant" },
          parts: [
            makeToolPart("grep", "error", { pattern: "some really long error pattern that needs pruning" }),
          ],
        },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      // The handler mutates output
      await transform({} as any, output);
    }

    const prunedPart = output.messages[1]!.parts[0] as any;
    expect(prunedPart.state?.status).toBe("error");
    expect(prunedPart.state?.input?.pattern).toBe("[input pruned after failed tool call]");
  });

  test("skips non-error tool calls", async () => {
    const config = makeConfig();
    const handler = createErrorPruneHandler(config);

    const before = handler["tool.before"];
    if (before) await before({} as any);

    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hi" }],
        },
        {
          info: { role: "assistant" },
          parts: [
            makeToolPart("grep", "success", { pattern: "some pattern" }),
          ],
        },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      await transform({} as any, output);
    }

    const part = output.messages[1]!.parts[0] as any;
    expect(part.state?.status).toBe("success");
    expect(part.state?.input?.pattern).toBe("some pattern");
  });

  test("skips protected tools even on error", async () => {
    const config = makeConfig();
    const handler = createErrorPruneHandler(config);

    const before = handler["tool.before"];
    if (before) await before({} as any);

    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hi" }],
        },
        {
          info: { role: "assistant" },
          parts: [
            makeToolPart("read", "error", { filePath: "/important/file.ts" }),
          ],
        },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      await transform({} as any, output);
    }

    const part = output.messages[1]!.parts[0] as any;
    expect(part.state?.input?.filePath).toBe("/important/file.ts");
  });

  test("skips short input values (under 20 chars)", async () => {
    const config = makeConfig();
    const handler = createErrorPruneHandler(config);

    const before = handler["tool.before"];
    if (before) await before({} as any);

    const output = {
      messages: [
        {
          info: { role: "assistant" },
          parts: [
            makeToolPart("cmd", "error", { key: "short" }),
          ],
        },
      ],
    };

    const transform = handler["chat.messages.transform"];
    if (transform) {
      await transform({} as any, output);
    }

    const part = output.messages[0]!.parts[0] as any;
    expect(part.state?.input?.key).toBe("short");
  });
});
