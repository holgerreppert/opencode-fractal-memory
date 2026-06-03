import { describe, expect, test } from "bun:test";
import { CompressionHelper } from "./compression";
import type { MemoryNode } from "./types";

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: overrides.id ?? "test-id",
    scope: overrides.scope ?? "project",
    label: overrides.label ?? "test-node",
    content: overrides.content ?? "Some content here",
    summary: overrides.summary ?? null,
    level: overrides.level ?? 0,
    parentIds: overrides.parentIds ?? null,
    embedding: overrides.embedding ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    importance: overrides.importance ?? 0.5,
    accessCount: overrides.accessCount ?? 0,
    lastAccessed: overrides.lastAccessed ?? null,
    type: overrides.type ?? null,
    metadata: overrides.metadata ?? null,
    sticky: overrides.sticky ?? false,
    confidence: overrides.confidence ?? 0,
    lastVerified: overrides.lastVerified ?? null,
    usefulnessScore: overrides.usefulnessScore ?? 0,
    timesUsed: overrides.timesUsed ?? 0,
    timesHelpful: overrides.timesHelpful ?? 0,
  };
}

describe("CompressionHelper.generateLLMSummaryPrompt", () => {
  test("returns a prompt string containing the node content", () => {
    const node = makeNode({ content: "Specific test content here" });
    const prompt = CompressionHelper.generateLLMSummaryPrompt(node);
    expect(prompt).toContain("Specific test content here");
    expect(prompt).toContain("summary");
  });
});

describe("CompressionHelper.generateLLMSummary", () => {
  test("falls back to structured summary when no client", async () => {
    const nodes = [
      makeNode({
        label: "node-a",
        content: "We decided to use TypeScript for this project. We chose Bun as runtime.",
        importance: 0.8,
      }),
      makeNode({
        label: "node-b",
        content: "Next step: implement the database layer. Use src/db.ts for schema.",
        importance: 0.6,
      }),
    ];

    const summary = await CompressionHelper.generateLLMSummary(nodes, undefined);
    expect(summary).toBeTruthy();
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });
});

describe("CompressionHelper.generateStructuredSummary", () => {
  test("extracts decisions and files from node content", () => {
    const nodes = [
      makeNode({
        content: "We decided to use SQLite for storage. We chose the src/storage/sqlite.ts architecture.",
      }),
    ];

    const summary = CompressionHelper.generateStructuredSummary(nodes);
    expect(summary).toContain("Decisions");
    expect(summary).toContain("Files");
  });

  test("extracts tools mentioned in content", () => {
    const nodes = [
      makeNode({
        content: "Used memory_search to find the node. Then ran bun test to verify.",
      }),
    ];

    const summary = CompressionHelper.generateStructuredSummary(nodes);
    expect(summary).toContain("Tools");
    expect(summary).toContain("memory_search");
    expect(summary).toContain("bun");
  });

  test("extracts next steps from content", () => {
    const nodes = [
      makeNode({
        content: "Next step: deploy to production.\n- Todo: update the README",
      }),
    ];

    const summary = CompressionHelper.generateStructuredSummary(nodes);
    expect(summary).toContain("Next Steps");
    expect(summary).toContain("deploy");
    expect(summary).toContain("README");
  });
});

describe("CompressionHelper.findCompressionCandidates", () => {
  test("returns empty for unknown level", async () => {
    const candidates = await CompressionHelper.findCompressionCandidates(
      [makeNode()],
      99 as any
    );
    expect(candidates).toEqual([]);
  });

  test("excludes sticky nodes", async () => {
    const nodes = [
      makeNode({ id: "a", content: "x".repeat(200), sticky: false }),
      makeNode({ id: "b", content: "x".repeat(200), sticky: true }),
    ];

    const candidates = await CompressionHelper.findCompressionCandidates(nodes, 0, 0, true);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe("a");
  });
});
