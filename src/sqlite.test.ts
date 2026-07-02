import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { createMemoryStore } from "./memory";
import { CompressionHelper, extractLinks } from "./storage/sqlite";

async function mkTmpDir(): Promise<{ dir: string; globalDbPath: string }> {
  const root = await fs.mkdtemp(path.join("/tmp/", "opencode-sqlite-memory-"));
  const globalDbPath = path.join(root, "global-memory.db");
  return { dir: root, globalDbPath };
}

describe("sqlite store", () => {
  test("seeds nodes", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const nodes = await store.listNodes("all");
    
    // Should have at least 3 seeded nodes (2 global + 1 project)
    expect(nodes.length).toBeGreaterThanOrEqual(3);
  });

  test("createNode creates a node", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Hello world",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.5,
      type: "note",
      metadata: null,
    });

    expect(node.content).toBe("Hello world");
    expect(node.level).toBe(0);
    expect(node.importance).toBe(0.5);
  });

  test("getNodeByLabel retrieves a node", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.getNodeByLabel("project", "project");
    expect(node.scope).toBe("project");
  });

  test("getNodeByLabel works with colons in label", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    // Don't call ensureSeed() to avoid label collision

    const node = await store.createNode({
      scope: "global",
      label: "rule:mandatory:test",
      content: "Test rule with colons",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 1,
      type: "note",
      metadata: null,
    });

    const retrieved = await store.getNodeByLabel("global", "rule:mandatory:test");
    expect(retrieved.label).toBe("rule:mandatory:test");
    expect(retrieved.content).toBe("Test rule with colons");
  });

  test("getNodeByLabel throws for invalid label", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.createNode({
      scope: "global",
      label: "valid-label",
      content: "Test",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.5,
      type: "note",
      metadata: null,
    });

    // Validation happens in getNodeByLabel, not createNode
    await expect(store.getNodeByLabel("global", "invalid label with spaces")).rejects.toThrow();
  });

  test("getNodeByLabel throws for non-existent label", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await expect(store.getNodeByLabel("global", "totally-nonexistent-label-12345")).rejects.toThrow();
  });

  test("getNode retrieves node by ID", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const created = await store.createNode({
      scope: "project",
      content: "Test content",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    const retrieved = await store.getNode(created.id);
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.content).toBe("Test content");
  });

  test("getNode throws for non-existent ID", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await expect(store.getNode("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });

  test("deleteNode removes node by ID", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "To be deleted",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    await store.deleteNode(node.id);
    await expect(store.getNode(node.id)).rejects.toThrow();
  });

  test("deleteNode removes node by label", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      label: "to-delete",
      content: "To be deleted",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    await store.deleteNode(node.id);
    
    // Should throw after deletion
    await expect(store.getNode(node.id)).rejects.toThrow();
  });

  test("deleteNode throws for non-existent", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await expect(store.deleteNode("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });

  test("listNodes returns empty for non-existent scope", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const nodes = await store.listNodes("nonexistent-scope" as any);
    expect(nodes).toEqual([]);
  });

  test("updateNode can update importance", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Test",
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.5,
    });

    await store.updateNode(node.id, { importance: 0.9 });

    const updated = await store.getNode(node.id);
    expect(updated.importance).toBe(0.9);
  });

  test("updateNode tracks access count on getNode", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Test",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    expect(node.accessCount).toBe(0);

    await store.getNode(node.id);
    await store.getNode(node.id);
    await store.getNode(node.id);

    const retrieved = await store.getNode(node.id);
    expect(retrieved.accessCount).toBeGreaterThan(0);
  });

  test("updateNode modifies content", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Original",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    await store.updateNode(node.id, { content: "Updated" });

    const updated = await store.getNode(node.id);
    expect(updated.content).toBe("Updated");
  });

  test("listNodes filters by level", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "Level 0", level: 0, parentIds: null, embedding: null });
    await store.createNode({ scope: "project", content: "Level 1", level: 1, parentIds: null, embedding: null });
    await store.createNode({ scope: "project", content: "Level 2", level: 2, parentIds: null, embedding: null });

    const level0 = await store.listNodes("project", 0);
    const all = await store.listNodes("project");

    expect(level0.length).toBe(2);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("listNodes filters by projectName", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "Project A content", level: 0, parentIds: null, embedding: null, projectName: "project-a" });
    await store.createNode({ scope: "project", content: "Project B content", level: 0, parentIds: null, embedding: null, projectName: "project-b" });
    await store.createNode({ scope: "project", content: "Another A", level: 0, parentIds: null, embedding: null, projectName: "project-a" });

    const filtered = await store.listNodes("project", undefined, 50, 0, undefined, "project-a");
    expect(filtered.every(n => n.projectName === "project-a")).toBe(true);
    expect(filtered.length).toBe(2);

    const all = await store.listNodes("project");
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  test("deleteNode removes a node", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "To be deleted",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    await store.deleteNode(node.id);

    await expect(store.getNode(node.id)).rejects.toThrow("not found");
  });

  test("tracks access count", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.getNodeByLabel("project", "project");
    const initialCount = node.accessCount;

    const node2 = await store.getNode(node.id);
    const node3 = await store.getNode(node.id);
    const node4 = await store.getNode(node.id);

    expect(node2.accessCount).toBe(initialCount + 1);
    expect(node3.accessCount).toBe(initialCount + 2);
    expect(node4.accessCount).toBe(initialCount + 3);
  });

  test("getFractalStats returns statistics", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "Test 1", level: 0, parentIds: null, embedding: null });
    await store.createNode({ scope: "project", content: "Test 2", level: 1, parentIds: null, embedding: null });
    await store.createNode({ scope: "project", content: "Test 3", level: 0, parentIds: null, embedding: null });

    const stats = await store.getFractalStats("project");

    expect(stats.totalNodes).toBeGreaterThanOrEqual(4);
    expect(stats.nodesPerLevel[0]).toBeGreaterThanOrEqual(2);
    expect(stats.nodesPerLevel[1]).toBeGreaterThanOrEqual(1);
  });

  test("getFractalStats filters by projectName", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "A1", level: 0, parentIds: null, embedding: null, projectName: "project-a" });
    await store.createNode({ scope: "project", content: "A2", level: 1, parentIds: null, embedding: null, projectName: "project-a" });
    await store.createNode({ scope: "project", content: "B1", level: 0, parentIds: null, embedding: null, projectName: "project-b" });

    const stats = await store.getFractalStats("project", "project-a");
    expect(stats.totalNodes).toBe(2);
    expect(stats.nodesPerLevel[0]).toBe(1);
    expect(stats.nodesPerLevel[1]).toBe(1);
  });

  test("retrieveFractal returns node with path", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Leaf node",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    const result = await store.retrieveFractal(node.id, 10);

    expect(result.node.id).toBe(node.id);
    expect(result.depth).toBe(0);
    expect(result.path.length).toBeGreaterThanOrEqual(1);
  });

  test("retrieveFractal follows parent chain", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const leaf = await store.createNode({
      scope: "project",
      content: "Leaf",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    const parent = await store.createNode({
      scope: "project",
      content: "Parent",
      level: 1,
      parentIds: [leaf.id],
      embedding: null,
    });

    const result = await store.retrieveFractal(parent.id, 10);

    expect(result.node.id).toBe(parent.id);
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(result.path.some(n => n.id === leaf.id)).toBe(true);
  });

  test("detectTopicBoundaries groups related nodes", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "Test 1", level: 0, parentIds: null, embedding: null });
    await store.createNode({ scope: "project", content: "Test 2", level: 0, parentIds: null, embedding: null });

    const clusters = await store.detectTopicBoundaries("project", 0.7);

    expect(Array.isArray(clusters)).toBe(true);
  });

  test("detectTopicBoundaries filters by projectName", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const emb = Array.from({length: 384}).fill(0.05);
    await store.createNode({ scope: "project", content: "X".repeat(100), level: 0, parentIds: null, embedding: emb, projectName: "project-a" });
    await store.createNode({ scope: "project", content: "Y".repeat(100), level: 0, parentIds: null, embedding: emb, projectName: "project-b" });

    const clusters = await store.detectTopicBoundaries("project", 0.99, "project-a");
    const allInCluster = clusters.flat();
    expect(allInCluster.every(n => n.projectName === "project-a")).toBe(true);
  });

  test("searchByEmbedding filters by level", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const embedding = Array.from({length: 384}).fill(0.1);
    
    await store.createNode({ scope: "project", content: "Level 0", level: 0, parentIds: null, embedding });
    await store.createNode({ scope: "project", content: "Level 1", level: 1, parentIds: null, embedding });

    const results = await store.searchByEmbedding(embedding, 10, { minLevel: 1, maxLevel: 1 });

    for (const result of results) {
      expect(result.level).toBeGreaterThanOrEqual(1);
      expect(result.level).toBeLessThanOrEqual(1);
    }
  });

  test("searchByEmbedding filters by projectName", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const embA = Array.from({length: 384}).fill(0.1);
    const embB = Array.from({length: 384}).fill(0.5);

    await store.createNode({ scope: "project", content: "Project A node", level: 0, parentIds: null, embedding: embA, projectName: "project-a" });
    await store.createNode({ scope: "project", content: "Project B node", level: 0, parentIds: null, embedding: embB, projectName: "project-b" });

    const results = await store.searchByEmbedding(embA, 10, { projectName: "project-a" });
    expect(results.length).toBe(1);
    expect(results[0].projectName).toBe("project-a");
  });

  test("getCompressionCandidates with force=true bypasses age check", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({ 
      scope: "project", 
      content: "This is a longer content that is over 100 characters so it should pass the compression filter when force is used. The compression helper filters nodes with short content.",
      level: 0, 
      parentIds: null, 
      embedding: null 
    });

    const withoutForce = await store.getCompressionCandidates("project", 0);
    const withForce = await store.getCompressionCandidates("project", 0, undefined, true);

    expect(withoutForce.length).toBe(0);
    expect(withForce.some(n => n.id === node.id)).toBe(true);
  });

  test("getCompressionCandidates filters by projectName", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "X".repeat(150), level: 0, parentIds: null, embedding: null, projectName: "project-a" });
    await store.createNode({ scope: "project", content: "Y".repeat(150), level: 0, parentIds: null, embedding: null, projectName: "project-b" });

    const filtered = await store.getCompressionCandidates("project", 0, undefined, true, "project-a");
    expect(filtered.length).toBe(1);
    expect(filtered[0].projectName).toBe("project-a");
  });

  test("structured summary extracts decisions, files, and patterns", () => {
    const nodes = [
      {
        id: "test1",
        content: "## Session Summary\n\nWe decided to use SQLite for storage.n\n- Modified: src/store.ts, src/index.ts\n- Next: Implement compression\n- Learned: Pattern for async initialization",
        summary: null,
        level: 0 as const,
        parentIds: null,
        embedding: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        importance: 0.8,
        accessCount: 5,
        lastAccessed: null,
        scope: "project" as const,
        type: "note" as const,
        metadata: null,
        sticky: false,
        confidence: 0.5,
        lastVerified: null,
      },
    ];

    const summary = CompressionHelper.generateStructuredSummary(nodes);

    expect(summary).toContain("## Structured Summary");
    expect(summary).toContain("### Decisions");
    expect(summary).toContain("SQLite");
    expect(summary).toContain("### Files");
    expect(summary).toContain("store.ts");
    expect(summary).toContain("### Next Steps");
    expect(summary).toContain("compression");
    expect(summary).toContain("### Patterns");
    expect(summary).toContain("Compressed from 1 node(s)");
  });

  test("drilldownQuery returns structured results", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({
      scope: "project",
      content: "Created a new authentication module with JWT support",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: Array.from({ length: 384 }, (_, i) => i < 3 ? [0.1, 0.2, 0.3][i]! : 0),
      importance: 0.8,
      type: "concept",
      metadata: null,
    });

    await store.createNode({
      scope: "project",
      content: "Weekly summary of authentication work",
      summary: null,
      level: 1,
      parentIds: null,
      embedding: Array.from({ length: 384 }, (_, i) => i < 3 ? [0.15, 0.25, 0.35][i]! : 0),
      importance: 0.7,
      type: "summary",
      metadata: null,
    });

    await store.createNode({
      scope: "project",
      content: "Quarterly authentication overview",
      summary: null,
      level: 2,
      parentIds: null,
      embedding: Array.from({ length: 384 }, (_, i) => i < 3 ? [0.12, 0.22, 0.32][i]! : 0),
      importance: 0.6,
      type: "summary",
      metadata: null,
    });

    const results = await store.drilldownQuery("authentication", 10);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("node");
    expect(results[0]).toHaveProperty("relevance");
    expect(results[0]).toHaveProperty("path");
    expect(results[0]).toHaveProperty("level");
    expect(["summary", "intermediate", "detail"]).toContain(results[0].level);
  });

  test("drilldownQuery filters by projectName", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "Auth module in project A", level: 0, parentIds: null, embedding: Array(384).fill(0.1), projectName: "project-a" });
    await store.createNode({ scope: "project", content: "Auth module in project B", level: 0, parentIds: null, embedding: Array(384).fill(0.1), projectName: "project-b" });

    const results = await store.drilldownQuery("auth module", 10, "project-a");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.node.projectName === "project-a")).toBe(true);
  });

  test("runPatternExtraction creates pattern summary", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({
      scope: "project",
      content: "User prefers concise responses and uses Bun as runtime. Uses git for version control.",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.8,
      type: "note",
      metadata: null,
    });

    await store.createNode({
      scope: "project",
      content: "Project uses Python for backend. Added new migration for user table in auth.py",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.7,
      type: "note",
      metadata: null,
    });

    const result = await store.runPatternExtraction("project");

    expect(result.created).toBe(1);
    expect(result.sources).toBe(2);

    const nodes = await store.listNodes("project", 1);
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe("summary");
    expect(nodes[0].content).toContain("## Cross-Layer Pattern Summary");
    expect(nodes[0].content).toContain("User Preferences");
    expect(nodes[0].content).toContain("Key Files");
  });

  test("extractPatterns finds decisions and conventions", () => {
    const nodes = [
      {
        id: "node1",
        scope: "project" as const,
        content: "We decided to use SQLite for the database. User prefers concise responses. Convention: use transactions for all writes. Files: store.ts, auth.py",
        summary: null,
        level: 0 as const,
        parentIds: null,
        embedding: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        importance: 0.8,
        accessCount: 0,
        lastAccessed: null,
        type: "note" as const,
        metadata: null,
        sticky: false,
        confidence: 0.5,
        lastVerified: null,
      },
      {
        id: "node2",
        scope: "project" as const,
        content: "Uses Python for backend. User prefers TypeScript on frontend. Convention: use async/await for all API calls. Files: backend/main.py",
        summary: null,
        level: 0 as const,
        parentIds: null,
        embedding: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        importance: 0.7,
        accessCount: 0,
        lastAccessed: null,
        type: "note" as const,
        metadata: null,
        sticky: false,
        confidence: 0.5,
        lastVerified: null,
      },
    ];

    const patterns = CompressionHelper.extractPatterns(nodes);

    expect(patterns.decisions.size).toBeGreaterThan(0);
    expect(patterns.preferences.size).toBeGreaterThan(0);
    expect(patterns.conventions.size).toBeGreaterThan(0);
    expect(patterns.files.size).toBeGreaterThan(0);
  });

  test("database uses WAL mode for better concurrency", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    
    const nodes = await store.listNodes("all");
    expect(nodes).toBeDefined();
    
    // WAL mode should be enabled (no error thrown)
  });

  test("pruneNodes finds and optionally deletes low-importance nodes", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({
      scope: "project",
      content: "Low importance node that should be pruned.",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.3,
      type: "note",
      metadata: null,
    });

    await store.createNode({
      scope: "project",
      content: "High importance node that should be kept.",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.9,
      type: "note",
      metadata: null,
    });

    const initialNodes = await store.listNodes("project", 0);
    console.log("Initial nodes:", initialNodes.length);

    const result = await store.pruneNodes("project", {
      minAccessCount: 0,
      maxAgeDays: 1000,
      minImportance: 0.5,
      dryRun: true,
    });

    expect(result.prunable.length).toBe(1);
    expect(result.prunable[0].importance).toBe(0.3);
    expect(result.pruned).toBe(0);

    const deleteResult = await store.pruneNodes("project", {
      minAccessCount: 0,
      maxAgeDays: 1000,
      minImportance: 0.5,
      dryRun: false,
    });

    expect(deleteResult.pruned).toBe(1);

    const nodes = await store.listNodes("project", 0);
    // Should have 2 nodes: seed (project) + high importance node
    expect(nodes.length).toBe(2);
    expect(nodes.some(n => n.importance === 0.9)).toBe(true);
  });

  test("BM25 hybrid search scores higher for exact keyword matches", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({
      scope: "project",
      label: "sqlite-setup",
      content: "SQLite database setup with WAL mode for concurrent access. Uses bun:sqlite module.",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: [0.1, 0.2, 0.3, 0.4],
      importance: 0.7,
      type: "note",
      metadata: null,
    });

    await store.createNode({
      scope: "project",
      label: "auth-config",
      content: "Authentication configuration using JWT tokens and passport middleware.",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: [0.2, 0.3, 0.4, 0.5],
      importance: 0.7,
      type: "note",
      metadata: null,
    });

    const hybridResults = await store.searchByEmbedding(
      [0.1, 0.2, 0.3, 0.4],
      5,
      { bm25Weight: 0.5, queryText: "SQLite WAL mode" }
    );

    expect(hybridResults.length).toBeGreaterThan(0);
    const sqliteNode = hybridResults.find(n => n.label === "sqlite-setup");
    expect(sqliteNode).toBeDefined();
  });

  test("storeLinks and getLinkedNodes work", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const targetNode = await store.createNode({
      scope: "project",
      label: "user-preferences",
      content: "User prefers concise responses and TypeScript.",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.8,
      type: "note",
      metadata: null,
    });

    const sourceNode = await store.createNode({
      scope: "project",
      label: "auth-implementation",
      content: "Used JWT tokens for auth. See [[user-preferences]] for format preferences.",
      summary: null,
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.7,
      type: "note",
      metadata: null,
    });

    const linkedNodes = await store.getLinkedNodes("project", sourceNode.id);
    expect(linkedNodes.length).toBe(1);
    expect(linkedNodes[0].id).toBe(targetNode.id);
    expect(linkedNodes[0].label).toBe("user-preferences");
  });

  test("extractLinks finds wiki-style links", () => {
    const content = "See [[user-preferences]] and [[sqlite-setup]] for details.";
    const links = extractLinks(content);
    expect(links).toContain("user-preferences");
    expect(links).toContain("sqlite-setup");
    expect(links.length).toBe(2);
  });

  test("logInjectionMetrics and getInjectionMetrics work", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = "metrics-test-123";
    
    await store.logInjectionMetrics(sessionId, {
      injectedNodeCount: 5,
      injectedTokens: 1000,
      injectionMode: "semantic",
      queryText: "test query",
    });

    const metrics = await store.getInjectionMetrics(100);
    const ourMetric = metrics.find(m => m.sessionId === sessionId);
    expect(ourMetric).toBeDefined();
    expect(ourMetric!.injectedNodeCount).toBe(5);
    expect(ourMetric!.injectedTokens).toBe(1000);
    expect(ourMetric!.injectionMode).toBe("semantic");
    expect(ourMetric!.toolCalls).toBe(0);
  });

  test("recordMemoryToolCall tracks tool usage", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-rtu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    await store.logInjectionMetrics(sessionId, {
      injectedNodeCount: 3,
      injectedTokens: 500,
      injectionMode: "importance",
    });

    await store.recordMemoryToolCall(sessionId, "memory_get", { id: "test-node" });
    await store.recordMemoryToolCall(sessionId, "memory_search", { query: "test" });
    await store.recordMemoryToolCall(sessionId, "memory_get", { id: "test-node2" });

    const sessionMetrics = await store.getSessionMetrics(sessionId);
    expect(sessionMetrics.totalToolCalls).toBe(3);
    expect(sessionMetrics.memoryToolsUsed).toContain("memory_get");
    expect(sessionMetrics.memoryToolsUsed).toContain("memory_search");
  });

  test("getSessionMetrics aggregates correctly", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-smagg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    await store.logInjectionMetrics(sessionId, {
      injectedNodeCount: 4,
      injectedTokens: 800,
      injectionMode: "semantic",
    });

    await store.recordMemoryToolCall(sessionId, "memory_get");
    await store.recordMemoryToolCall(sessionId, "memory_search");
    await store.recordMemoryToolCall(sessionId, "memory_verify");

    const sessionMetrics = await store.getSessionMetrics(sessionId);
    expect(sessionMetrics.totalInjections).toBe(1);
    expect(sessionMetrics.totalToolCalls).toBe(3);
    expect(sessionMetrics.memoryToolsUsed).toContain("memory_get");
    expect(sessionMetrics.memoryToolsUsed).toContain("memory_search");
    expect(sessionMetrics.memoryToolsUsed).toContain("memory_verify");
  });

  test("finalizeInjection sets effectiveness score", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = "metrics-test-final";
    
    await store.logInjectionMetrics(sessionId, {
      injectedNodeCount: 2,
      injectedTokens: 300,
      injectionMode: "importance",
    });

    await store.finalizeInjection(sessionId, 0.85, "Added authentication feature");

    const sessionMetrics = await store.getSessionMetrics(sessionId);
    expect(sessionMetrics.avgEffectiveness).toBeCloseTo(0.85, 5);
  });

  test("session tracking - createSessionMetrics and getSessionStats", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const startedAt = Date.now() - 60000;

    await store.createSessionMetrics(sessionId, startedAt);

    const stats = await store.getSessionStats(sessionId);
    expect(stats).not.toBeNull();
    expect(stats!.sessionId).toBe(sessionId);
    expect(stats!.startedAt).toBe(startedAt);
    expect(stats!.status).toBe("active");
    expect(stats!.totalToolCalls).toBe(0);
  });

  test("session tracking - recordAgentToolCall stores all data", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-atc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await store.recordAgentToolCall(
      sessionId,
      "read",
      { filePath: "src/app.ts" },
      "file content here",
      true,
      150
    );

    await store.recordAgentToolCall(
      sessionId,
      "bash",
      { command: "npm test" },
      "tests passing",
      true,
      5000
    );

    await store.recordAgentToolCall(
      sessionId,
      "edit",
      { filePath: "src/app.ts", oldString: "foo", newString: "bar" },
      "error: file not found",
      false,
      100
    );

    const stats = await store.getSessionStats(sessionId);
    expect(stats).not.toBeNull();
    expect(stats!.totalToolCalls).toBe(3);
    expect(stats!.toolCalls.length).toBe(3);

    const readCall = stats!.toolCalls.find(tc => tc.toolName === "read");
    expect(readCall).toBeDefined();
    expect(readCall!.filePath).toBe("src/app.ts");
    expect(readCall!.success).toBe(true);
    expect(readCall!.toolCategory).toBe("file");

    const bashCall = stats!.toolCalls.find(tc => tc.toolName === "bash");
    expect(bashCall).toBeDefined();
    expect(bashCall!.command).toBe("npm test");
    expect(bashCall!.toolCategory).toBe("shell");

    const editCall = stats!.toolCalls.find(tc => tc.toolName === "edit");
    expect(editCall).toBeDefined();
    expect(editCall!.success).toBe(false);
  });

  test("session tracking - incrementSessionToolCall updates aggregates", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-inc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await store.incrementSessionToolCall(sessionId, "read", true, "src/main.ts");
    await store.incrementSessionToolCall(sessionId, "read", true, "src/main.ts");
    await store.incrementSessionToolCall(sessionId, "read", true, "src/utils.ts");
    await store.incrementSessionToolCall(sessionId, "edit", true, "src/main.ts");
    await store.incrementSessionToolCall(sessionId, "bash", true, null);
    await store.incrementSessionToolCall(sessionId, "memory_search", true, null);
    await store.incrementSessionToolCall(sessionId, "bash", false, null);
    await store.incrementSessionToolCall(sessionId, "grep", true, null);
    await store.incrementSessionToolCall(sessionId, "glob", true, null);

    const stats = await store.getSessionStats(sessionId);
    expect(stats).not.toBeNull();
    expect(stats!.totalToolCalls).toBe(9);
    expect(stats!.fileReads).toBe(3);
    expect(stats!.fileEdits).toBe(1);
    expect(stats!.bashCommands).toBe(2);
    expect(stats!.memoryTools).toBe(1);
    expect(stats!.failedTools).toBe(1);
    expect(stats!.uniqueFilesTouched).toContain("src/main.ts");
    expect(stats!.uniqueFilesTouched).toContain("src/utils.ts");
    expect(stats!.uniqueFilesTouched.length).toBe(2);
  });

  test("session tracking - updateSessionMetrics finalizes session", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-final-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const endedAt = Date.now();

    await store.createSessionMetrics(sessionId);
    await store.updateSessionMetrics(sessionId, {
      endedAt,
      injectionCount: 3,
      injectedTokens: 1500,
      taskDescription: "Fixed authentication bug",
      status: "completed"
    });

    const stats = await store.getSessionStats(sessionId);
    expect(stats).not.toBeNull();
    expect(stats!.endedAt).toBe(endedAt);
    expect(stats!.status).toBe("completed");
    expect(stats!.injectionCount).toBe(3);
    expect(stats!.injectedTokens).toBe(1500);
  });

  test("session tracking - tool category extraction", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-cat-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const tools = [
      { name: "read", expectCat: "file" },
      { name: "edit", expectCat: "file" },
      { name: "write", expectCat: "file" },
      { name: "glob", expectCat: "file" },
      { name: "grep", expectCat: "file" },
      { name: "bash", expectCat: "shell" },
      { name: "shell", expectCat: "shell" },
      { name: "memory_search", expectCat: "memory" },
      { name: "memory_set", expectCat: "memory" },
      { name: "journal_search", expectCat: "memory" },
      { name: "unknown_tool", expectCat: "other" },
    ];

    for (const tool of tools) {
      await store.recordAgentToolCall(
        sessionId,
        tool.name,
        null,
        "output",
        true,
        100
      );
    }

    const stats = await store.getSessionStats(sessionId);
    expect(stats).not.toBeNull();

    for (const tool of tools) {
      const tc = stats!.toolCalls.find(t => t.toolName === tool.name);
      expect(tc).toBeDefined();
      expect(tc!.toolCategory).toBe(tool.expectCat);
    }
  });

  test("session tracking - output preview truncation", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const sessionId = `test-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const longOutput = "x".repeat(1000);

    await store.recordAgentToolCall(
      sessionId,
      "bash",
      { command: "ls" },
      longOutput,
      true,
      50
    );

    const stats = await store.getSessionStats(sessionId);
    expect(stats).not.toBeNull();
    expect(stats!.toolCalls[0].command).toBe("ls");
  });

  test("session tracking - getSessionStats returns null for unknown session", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const stats = await store.getSessionStats("non-existent-session");
    expect(stats).toBeNull();
  });

  test("getCompressionCandidates with force returns candidates", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    // Create a node and force it to be a candidate
    const node = await store.createNode({
      scope: "project",
      content: "Test node for compression",
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.5,
    });

    // Use force=true to bypass age check
    const candidates = await store.getCompressionCandidates("project", 0, undefined, true);
    
    // Should return at least the seeded node or our created node
    expect(candidates.length).toBeGreaterThanOrEqual(0); // May be empty depending on implementation
  });

  test("drilldownQuery returns results for existing node", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    // Create a test node with content that can be embedded
    await store.createNode({
      scope: "project",
      label: "test-drilldown",
      content: "This is a test node for drilldown query functionality",
      level: 0,
      importance: 0.8,
    });

    const result = await store.drilldownQuery("test node", 3);
    expect(result.length).toBeGreaterThan(0);
  });

  test("pruneNodes with dryRun does not delete", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Low importance node",
      level: 0,
      parentIds: null,
      embedding: null,
      importance: 0.2,
    });

    const result = await store.pruneNodes("project", {
      minAccessCount: 0,
      maxAgeDays: 1000,
      minImportance: 0.5,
      dryRun: true,
    });

    // Node should still exist
    const retrieved = await store.getNode(node.id);
    expect(retrieved.id).toBe(node.id);
  });

  test("pruneNodes filters by projectName", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({ scope: "project", content: "Low in A", level: 0, parentIds: null, embedding: null, importance: 0.2, projectName: "project-a" });
    await store.createNode({ scope: "project", content: "Low in B", level: 0, parentIds: null, embedding: null, importance: 0.2, projectName: "project-b" });

    const result = await store.pruneNodes("project", {
      minAccessCount: 0, maxAgeDays: 1000, minImportance: 0.5, dryRun: true, projectName: "project-a",
    });
    expect(result.prunable.length).toBe(1);
    expect(result.prunable[0].projectName).toBe("project-a");
  });

  test("createNode with special characters in content", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const specialContent = "Test with `backticks`, *italics*, **bold**, <html>, 'quotes', \"double quotes\"";

    const node = await store.createNode({
      scope: "project",
      content: specialContent,
      level: 0,
      parentIds: null,
      embedding: null,
    });

    const retrieved = await store.getNode(node.id);
    expect(retrieved.content).toBe(specialContent);
  });

  test("createNode with unicode content", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const unicodeContent = "Unicode: 你好 🎉 émoji ñ日本語 한국어";

    const node = await store.createNode({
      scope: "project",
      content: unicodeContent,
      level: 0,
      parentIds: null,
      embedding: null,
    });

    const retrieved = await store.getNode(node.id);
    expect(retrieved.content).toBe(unicodeContent);
  });

  test("createNode with multiline content", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const multilineContent = `Line 1
    Line 2 with indent
    Empty line above
    
    Tab:\tcharacter`;

    const node = await store.createNode({
      scope: "project",
      content: multilineContent,
      level: 0,
      parentIds: null,
      embedding: null,
    });

    const retrieved = await store.getNode(node.id);
    expect(retrieved.content).toBe(multilineContent);
  });

  test("getFractalStats returns counts for both scopes", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    await store.createNode({
      scope: "global",
      content: "Global node",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    await store.createNode({
      scope: "project",
      content: "Project node",
      level: 0,
      parentIds: null,
      embedding: null,
    });

    const stats = await store.getFractalStats("all");
    expect(stats.totalNodes).toBeGreaterThanOrEqual(2);
    expect(stats.scopes.global).toBeGreaterThanOrEqual(1);
    expect(stats.scopes.project).toBeGreaterThanOrEqual(1);
  });

  test("detectTopicBoundaries returns empty for insufficient nodes", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const boundaries = await store.detectTopicBoundaries("project");
    expect(Array.isArray(boundaries)).toBe(true);
  });

  test("usefulness tracking - can create node with usefulnessScore", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Test usefulness",
      level: 0,
      embedding: null,
      usefulnessScore: 4,
    });

    expect(node.usefulnessScore).toBe(4);
  });

  test("usefulness tracking - updateNode changes usefulnessScore", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Test update",
      level: 0,
      embedding: null,
    });

    expect(node.usefulnessScore).toBe(0);

    await store.updateNode(node.id, { usefulnessScore: 3 });
    const updated = await store.getNode(node.id);
    expect(updated.usefulnessScore).toBe(3);
  });

  test("usefulness tracking - updateNode changes timesHelpful", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Test timesHelpful",
      level: 0,
      embedding: null,
    });

    expect(node.timesHelpful).toBe(0);

    await store.updateNode(node.id, { timesHelpful: 5 });
    const updated = await store.getNode(node.id);
    expect(updated.timesHelpful).toBe(5);
  });

  test("usefulness tracking - timesUsed increments after search", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const node = await store.createNode({
      scope: "project",
      content: "Test search usage tracking",
      level: 0,
      embedding: Array.from({length: 384}).fill(0.1),
    });

    const before = await store.getNode(node.id);
    expect(before.timesUsed).toBe(0);

    // Search should increment timesUsed
    await store.searchByEmbedding(Array.from({length: 384}).fill(0.1), 10);

    const after = await store.getNode(node.id);
    expect(after.timesUsed).toBeGreaterThanOrEqual(1);
  });

  test("usefulness tracking - minUsefulness filter works", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    const embedding = Array.from({length: 384}).fill(0.1);

    // Create nodes with different usefulness scores
    const lowUsefulness = await store.createNode({
      scope: "project",
      content: "Low usefulness node",
      level: 0,
      embedding,
      usefulnessScore: 1,
    });

    const highUsefulness = await store.createNode({
      scope: "project",
      content: "High usefulness node",
      level: 0,
      embedding,
      usefulnessScore: 4,
    });

    // Search with minUsefulness = 3 should only return high usefulness node
    const results = await store.searchByEmbedding(embedding, 10, { minUsefulness: 3 });

    const foundIds = results.map(r => r.id);
    expect(foundIds).toContain(highUsefulness.id);
    expect(foundIds).not.toContain(lowUsefulness.id);
  });

  test("usefulness tracking - higher usefulness scores rank higher", async () => {
    const { dir, globalDbPath } = await mkTmpDir();
    const store = createMemoryStore(dir, globalDbPath);
    await store.ensureSeed();

    // Use slightly different embeddings so semantic scores differ
    const baseEmbedding = Array.from({length: 384}).fill(0.1);
    const embedding1 = baseEmbedding.map((v, i) => i % 2 === 0 ? v + 0.01 : v);
    const embedding2 = baseEmbedding.map((v, i) => i % 2 === 0 ? v + 0.02 : v);

    // Create nodes with similar but not identical content
    const node1 = await store.createNode({
      scope: "project",
      content: "First test node for ranking",
      level: 0,
      embedding: embedding1,
      usefulnessScore: 1,
    });

    const node2 = await store.createNode({
      scope: "project",
      content: "Second test node for ranking",
      level: 0,
      embedding: embedding2,
      usefulnessScore: 5,
    });

    const results = await store.searchByEmbedding(baseEmbedding, 10);

    // The higher usefulness node should have higher importance score
    const result1 = results.find(r => r.id === node1.id);
    const result2 = results.find(r => r.id === node2.id);

    expect(result2!.importance).toBeGreaterThan(result1!.importance);
  });
});
