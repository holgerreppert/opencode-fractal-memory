import { describe, expect, test } from "bun:test";
import { Router } from "./router";
import { registerRoutes } from "./routes";
import { rowToNode, computeStats, extractLinks, getAvailableScopes } from "./helpers";

describe("rowToNode", () => {
  test("transforms raw DB row to MemoryNode shape", () => {
    const row = {
      id: "node-1", label: "test", content: "hello",
      summary: "sum", level: 0, type: "note", importance: 0.8,
      usefulness_score: 4, times_used: 5, times_helpful: 3,
      access_count: 10, sticky: 1, confidence: 0.9,
      created_at: 1000, updated_at: 2000,
      parent_ids: '["parent-1"]', content_length: 5,
      metadata: '{"key":"val"}', project_name: "proj",
      domain: null,
    };
    const node = rowToNode(row);
    expect(node.id).toBe("node-1");
    expect(node.label).toBe("test");
    expect(node.content).toBe("hello");
    expect(node.level).toBe(0);
    expect(node.type).toBe("note");
    expect(node.importance).toBe(0.8);
    expect(node.usefulnessScore).toBe(4);
    expect(node.sticky).toBe(true);
    expect(node.parentIds).toEqual(["parent-1"]);
    expect(node.metadata).toEqual({ key: "val" });
    expect(node.projectName).toBe("proj");
  });

  test("handles null parent_ids and metadata", () => {
    const row = {
      id: "node-2", label: "", content: "test",
      summary: null, level: null, type: null, importance: null,
      usefulness_score: null, times_used: null, times_helpful: null,
      access_count: null, sticky: 0, confidence: null,
      created_at: 1000, updated_at: 2000,
      parent_ids: null, content_length: 4,
      metadata: null, project_name: null,
    };
    const node = rowToNode(row);
    expect(node.parentIds).toBeNull();
    expect(node.metadata).toBeNull();
    expect(node.projectName).toBeNull();
    expect(node.label).toBe("");
  });
});

describe("computeStats", () => {
  test("computes aggregate stats from nodes", () => {
    const nodes = [
      { id: "1", type: "note", level: 0, importance: 0.5, usefulnessScore: 3, accessCount: 0, metadata: null, projectName: null },
      { id: "2", type: "concept", level: 1, importance: 0.8, usefulnessScore: 4, accessCount: 2, metadata: null, projectName: "proj-a" },
      { id: "3", type: "note", level: 0, importance: 0.3, usefulnessScore: 2, accessCount: 5, metadata: null, projectName: null },
      { id: "4", type: "howto", level: 2, importance: 0.9, usefulnessScore: 5, accessCount: 1, metadata: { customType: "playbook" }, projectName: "proj-b" },
    ];
    const stats = computeStats(nodes);
    expect(stats.totalNodes).toBe(4);
    expect(stats.nodesPerLevel).toEqual({ 0: 2, 1: 1, 2: 1 });
    expect(stats.nodesPerType).toEqual({ note: 2, concept: 1, howto: 1 });
    expect(stats.avgImportance).toBeCloseTo(0.63, 1);
    expect(stats.avgUsefulness).toBeCloseTo(3.5);
    expect(stats.totalAccessCount).toBe(8);
  });

  test("handles empty array", () => {
    const stats = computeStats([]);
    expect(stats.totalNodes).toBe(0);
    expect(stats.nodesPerLevel).toEqual({});
    expect(stats.avgImportance).toBe(0);
    expect(stats.totalAccessCount).toBe(0);
  });

  test("resolves custom type shapes", () => {
    const nodes = [
      { id: "1", type: "note", level: 0, importance: 0.5, usefulnessScore: 0, metadata: { customType: "middle-term" }, projectName: null },
      { id: "2", type: "event", level: 0, importance: 0.5, usefulnessScore: 0, metadata: null, projectName: null },
    ];
    const stats = computeStats(nodes);
    expect(stats.nodesPerShape).toEqual({ torus: 1, box: 1 });
    expect(stats.nodesPerCustomType).toEqual({ "middle-term": 1 });
  });
});

describe("extractLinks", () => {
  test("extracts parent links from parentIds", () => {
    const nodes = [
      { id: "a", label: "A", parentIds: null, content: "" },
      { id: "b", label: "B", parentIds: ["a"], content: "" },
    ];
    const links = extractLinks(nodes);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ source: "b", target: "a", type: "parent" });
  });

  test("extracts wiki links from content", () => {
    const nodes = [
      { id: "a", label: "Target", parentIds: null, content: "" },
      { id: "b", label: "Source", parentIds: null, content: "See [[Target]] for details" },
    ];
    const links = extractLinks(nodes);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ source: "b", target: "a", type: "link" });
  });

  test("deduplicates same-typed links", () => {
    const nodes = [
      { id: "a", label: "Target", parentIds: null, content: "" },
      { id: "b", label: "Source", parentIds: ["a"], content: "See [[Target]] more times [[Target]]" },
    ];
    const links = extractLinks(nodes);
    expect(links).toHaveLength(2);
  });

  test("parent link and wiki link to same node are separate", () => {
    const nodes = [
      { id: "a", label: "Target", parentIds: null, content: "" },
      { id: "b", label: "Source", parentIds: ["a"], content: "See [[Target]]" },
    ];
    const links = extractLinks(nodes);
    expect(links).toHaveLength(2);
    expect(links).toEqual(
      expect.arrayContaining([
        { source: "b", target: "a", type: "parent" },
        { source: "b", target: "a", type: "link" },
      ]),
    );
  });

  test("returns empty array for no links", () => {
    expect(extractLinks([])).toEqual([]);
  });
});

describe("getAvailableScopes", () => {
  test("returns available scopes as array", () => {
    const scopes = getAvailableScopes();
    expect(Array.isArray(scopes)).toBe(true);
  });
});

describe("Router", () => {
  const router = new Router();
  

  test("registers and matches GET route", async () => {
    router.get(/^\/api\/test$/, () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const req = new Request("http://localhost/api/test");
    const res = await router.handle(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ ok: true });
  });

  test("returns null for unmatched route", async () => {
    const req = new Request("http://localhost/api/notfound");
    const res = await router.handle(req);
    expect(res).toBeNull();
  });

  test("handles POST method matching", async () => {
    let method = "";
    router.post(/^\/api\/submit$/, (req) => {
      method = req.method;
      return new Response("ok", { status: 200 });
    });
    const req = new Request("http://localhost/api/submit", { method: "POST" });
    const res = await router.handle(req);
    expect(res!.status).toBe(200);
    expect(method).toBe("POST");
  });

  test("GET does not match POST-only route", async () => {
    const req = new Request("http://localhost/api/submit", { method: "GET" });
    const res = await router.handle(req);
    expect(res).toBeNull();
  });

  test("extracts named params from URL", async () => {
    let captured = "";
    router.get(/^\/api\/items\/(?<id>[^/]+)$/, (_, c) => {
      captured = c.params.id!;
      return new Response("ok", { status: 200 });
    });
    const req = new Request("http://localhost/api/items/abc123");
    const res = await router.handle(req);
    expect(res!.status).toBe(200);
    expect(captured).toBe("abc123");
  });

  test("catch-all error handler returns 500", async () => {
    router.get(/^\/api\/crash$/, () => { throw new Error("boom"); });
    const req = new Request("http://localhost/api/crash");
    const res = await router.handle(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
    const body = await res!.json();
    expect(body.error).toBe("boom");
  });

  test("registerRoutes binds all API routes", async () => {
    const fullRouter = new Router();
    registerRoutes(fullRouter, null);

    const routes: Array<{ path: string; method: string }> = [
      { path: "/api/scopes", method: "GET" },
      { path: "/api/version", method: "GET" },
      { path: "/api/nodes", method: "GET" },
      { path: "/api/links", method: "GET" },
      { path: "/api/stats", method: "GET" },
      { path: "/api/projects", method: "GET" },
      { path: "/api/config", method: "GET" },
      { path: "/api/config", method: "PUT" },
      { path: "/api/inject", method: "POST" },
      { path: "/api/search", method: "GET" },
      { path: "/api/compress-stats", method: "GET" },
      { path: "/api/injection-quality", method: "GET" },
      { path: "/api/context-dashboard", method: "GET" },
      { path: "/api/backup-sources", method: "GET" },
      { path: "/api/backups", method: "GET" },
      { path: "/api/backup", method: "POST" },
      { path: "/api/restore", method: "POST" },
      { path: "/api/nodes/some-id", method: "PUT" },
      { path: "/api/nodes/some-id", method: "PATCH" },
      { path: "/api/nodes/some-id", method: "DELETE" },
      { path: "/api/backups/some-name", method: "DELETE" },
    ];

    for (const { path: p, method } of routes) {
      const req = new Request(`http://localhost${p}`, { method });
      const res = await fullRouter.handle(req);
      expect(res).not.toBeNull();
    }
  });
});
