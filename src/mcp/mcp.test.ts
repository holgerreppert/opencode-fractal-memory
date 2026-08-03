import type { MemoryNode, MemoryScope } from "../domain/ports/MemoryStore";
import { describe, expect, test } from "bun:test";
import { nodeToPlain, ensureScope } from "./transform";
import { sanitizeArgs } from "./logging";

describe("nodeToPlain", () => {
  const now = new Date("2026-01-01");
  const node = {
    id: "n1",
    scope: "global" as const,
    label: "test-label",
    content: "hello world",
    summary: "a summary",
    level: 1 as const,
    parentIds: ["p1"],
    embedding: null,
    createdAt: now,
    updatedAt: now,
    importance: 0.8,
    accessCount: 5,
    lastAccessed: null,
    type: "note" as const,
    category: "semantic" as const,
    supertype: "declarative" as const,
    domain: null,
    metadata: { key: "val" },
    tags: null,
    source: null,
    sticky: true,
    ttlDays: null,
    expiresAt: null,
    confidence: 0.9,
    lastVerified: null,
    verificationCount: 0,
    usefulnessScore: 4,
    timesUsed: 3,
    timesHelpful: 2,
    projectName: "my-project",
  };

  test("transforms MemoryNode to plain object", () => {
    const plain = nodeToPlain(node);
    expect(plain.id).toBe("n1");
    expect(plain.label).toBe("test-label");
    expect(plain.content).toBe("hello world");
    expect(plain.summary).toBe("a summary");
    expect(plain.level).toBe(1);
    expect(plain.type).toBe("note");
    expect(plain.importance).toBe(0.8);
    expect(plain.usefulnessScore).toBe(4);
    expect(plain.sticky).toBe(true);
    expect(plain.contentLength).toBe(11);
    expect(plain.metadata).toEqual({ key: "val" });
  });

  test("converts Date to timestamp", () => {
    const plain = nodeToPlain(node);
    expect(plain.createdAt).toBe(now.getTime());
    expect(plain.updatedAt).toBe(now.getTime());
  });

  test("handles null values", () => {
    const nullNode = {
      ...node,
      summary: null,
      parentIds: null,
      type: null,
      metadata: null,
      label: undefined,
    };
    const plain = nodeToPlain(nullNode as unknown as MemoryNode);
    expect(plain.summary).toBeNull();
    expect(plain.parentIds).toBeNull();
    expect(plain.type).toBeNull();
    expect(plain.metadata).toBeNull();
    expect(plain.label).toBe("");
  });

  test("handles Date as number (already converted)", () => {
    const numNode = { ...node, createdAt: 1000, updatedAt: 2000 };
    const plain = nodeToPlain(numNode as unknown as MemoryNode);
    expect(plain.createdAt).toBe(1000);
    expect(plain.updatedAt).toBe(2000);
  });
});

describe("ensureScope", () => {
  test("returns 'global' for global input", () => {
    expect(ensureScope("global")).toBe("global");
  });

  test("returns 'project' for project input", () => {
    expect(ensureScope("project")).toBe("project");
  });

  test("defaults to project when undefined", () => {
    expect(ensureScope(undefined)).toBe("project");
  });

  test("defaults to project for invalid scope", () => {
    expect(ensureScope("invalid" as MemoryScope)).toBe("project");
  });
});

describe("sanitizeArgs", () => {
  test("truncates long content fields", () => {
    const args = { content: "x".repeat(200) };
    const sanitized = sanitizeArgs(args);
    expect(sanitized.content).toContain("... [200 chars]");
    expect((sanitized.content as string).length).toBeLessThan(200);
  });

  test("truncates long query fields", () => {
    const args = { query: "a".repeat(100) };
    const sanitized = sanitizeArgs(args);
    expect(sanitized.query).toContain("... [100 chars]");
  });

  test("passes through short fields unchanged", () => {
    const args = { query: "short", content: "brief", other: "value" };
    const sanitized = sanitizeArgs(args);
    expect(sanitized.query).toBe("short");
    expect(sanitized.content).toBe("brief");
    expect(sanitized.other).toBe("value");
  });

  test("handles non-string values", () => {
    const args = { limit: 10, enabled: true };
    const sanitized = sanitizeArgs(args);
    expect(sanitized.limit).toBe(10);
    expect(sanitized.enabled).toBe(true);
  });

  test("handles empty args", () => {
    expect(sanitizeArgs({})).toEqual({});
  });
});
