import { describe, expect, test, beforeEach } from "bun:test";
import { createSqliteMemoryStore } from "./sqlite";
import { onNodeCreated, clearSessionEdges } from "./auto-edges";
import { setSessionId } from "../logging";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function setup() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-edges-test-"));
  const dbPath = path.join(tmpDir, "memory.db");
  const store = createSqliteMemoryStore(tmpDir, dbPath);
  return { tmpDir, store };
}

function cleanup(tmpDir: string) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  catch { /* best effort */ }
}

describe("auto-edges", () => {
  beforeEach(() => {
    setSessionId(null);
  });

  describe("extractLabelRefs", () => {
    test("extracts label:xxx patterns from content", async () => {
      const content = "Fixed bug:hnsw-rebuild-crash in session:debug-123";
      const { store } = setup();
      const nodeA = await store.createNode({ scope: "project", content: "a", label: "bug:hnsw-rebuild-crash", level: 0, embedding: null });
      await store.createNode({ scope: "project", content: "b", label: "session:debug-123", level: 0, embedding: null });

      await onNodeCreated(store, "project", nodeA.id, "test", content, "test-session");
      const edges = await store.getTemporalEdges(nodeA.id, "outgoing");
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("creates NEXT edge between consecutive nodes in same session", async () => {
    const { store } = setup();
    setSessionId("session-1");

    const node1 = await store.createNode({ scope: "project", content: "first", label: "node-1", level: 0, embedding: null });
    await onNodeCreated(store, "project", node1.id, "node-1", "first", "session-1");

    const node2 = await store.createNode({ scope: "project", content: "second", label: "node-2", level: 0, embedding: null });
    await onNodeCreated(store, "project", node2.id, "node-2", "second", "session-1");

    const edges = await store.getTemporalEdges(node1.id, "outgoing");
    expect(edges.some(e => e.targetNodeId === node2.id && e.edgeType === "NEXT")).toBe(true);

    clearSessionEdges("session-1");
  });

  test("creates REFERENCES edge when content mentions an existing label", async () => {
    const { store } = setup();
    setSessionId("session-2");

    const target = await store.createNode({ scope: "project", content: "the bug", label: "bug:some-bug", level: 0, embedding: null });

    const source = await store.createNode({ scope: "project", content: "fix for bug:some-bug in the code", label: "fix-node", level: 0, embedding: null });
    await onNodeCreated(store, "project", source.id, "fix-node", "fix for bug:some-bug in the code", "session-2");

    const edges = await store.getTemporalEdges(source.id, "outgoing");
    expect(edges.some(e => e.targetNodeId === target.id && e.edgeType === "REFERENCES")).toBe(true);

    clearSessionEdges("session-2");
  });

  test("does not create edges when no sessionId", async () => {
    const { store } = setup();
    setSessionId(null);

    const node1 = await store.createNode({ scope: "project", content: "first", label: "n1", level: 0, embedding: null });
    await onNodeCreated(store, "project", node1.id, "n1", "first", null);

    const node2 = await store.createNode({ scope: "project", content: "second", label: "n2", level: 0, embedding: null });
    await onNodeCreated(store, "project", node2.id, "n2", "second", null);

    const edges = await store.getTemporalEdges(node1.id, "outgoing");
    expect(edges.length).toBe(0);
  });

  test("extractLabelRefs detects label:xxx patterns", async () => {
    const { store } = setup();

    const node1 = await store.createNode({ scope: "project", content: "a", label: "bug:foo", level: 0, embedding: null });
    const node2 = await store.createNode({ scope: "project", content: "b", label: "decision:bar", level: 0, embedding: null });

    const source = await store.createNode({ scope: "project", content: "related to bug:foo and decision:bar", label: "src", level: 0, embedding: null });
    await onNodeCreated(store, "project", source.id, "src", "related to bug:foo and decision:bar", "session-3");

    const outgoing = await store.getTemporalEdges(source.id, "outgoing");
    expect(outgoing.some(e => e.targetNodeId === node1.id && e.edgeType === "REFERENCES")).toBe(true);
    expect(outgoing.some(e => e.targetNodeId === node2.id && e.edgeType === "REFERENCES")).toBe(true);
  });

  test("ignores label:xxx patterns that don't exist in the store", async () => {
    const { store } = setup();
    const node = await store.createNode({ scope: "project", content: "mentioning bug:nonexistent should not crash", label: "n", level: 0, embedding: null });
    await onNodeCreated(store, "project", node.id, "n", "mentioning bug:nonexistent should not crash", "session-4");

    const edges = await store.getTemporalEdges(node.id, "outgoing");
    expect(edges.filter(e => e.edgeType === "REFERENCES").length).toBe(0);
  });

  test("does not create self-referencing edge", async () => {
    const { store } = setup();
    const node = await store.createNode({ scope: "project", content: "self-reference to bug:self", label: "bug:self", level: 0, embedding: null });
    await onNodeCreated(store, "project", node.id, "bug:self", "self-reference to bug:self", "session-5");

    const outgoing = await store.getTemporalEdges(node.id, "outgoing");
    const selfRefs = outgoing.filter(e => e.targetNodeId === node.id);
    expect(selfRefs.length).toBe(0);
  });

  test("no NEXT edge between different sessions", async () => {
    const { store } = setup();
    setSessionId("session-a");

    const n1 = await store.createNode({ scope: "project", content: "session a first", label: "a1", level: 0, embedding: null });
    await onNodeCreated(store, "project", n1.id, "a1", "session a first", "session-a");

    setSessionId("session-b");
    const n2 = await store.createNode({ scope: "project", content: "session b first", label: "b1", level: 0, embedding: null });
    await onNodeCreated(store, "project", n2.id, "b1", "session b first", "session-b");

    const aEdges = await store.getTemporalEdges(n1.id, "outgoing");
    expect(aEdges.filter(e => e.edgeType === "NEXT").length).toBe(0);

    clearSessionEdges("session-a");
    clearSessionEdges("session-b");
  });
});
