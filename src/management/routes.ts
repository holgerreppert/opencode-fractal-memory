import { Database } from "bun:sqlite";
import { memLog } from "../logging";
import { generateEmbedding } from "../embeddings";
import { Router } from "./router";
import {
  queryNodes, getAvailableScopes, extractLinks, computeStats,
  readProjectConfig, writeProjectConfig, rowToNode,
  withDb, jsonResponse, cosineSimilarity, getAvailableProjects,
} from "./helpers";
import { VERSION } from "../version";

function handleScopes(): Response {
  return jsonResponse(getAvailableScopes());
}

function handleNodes(ctx: { scope: string }): Response {
  return jsonResponse(queryNodes(ctx.scope));
}

function handleLinks(ctx: { scope: string }): Response {
  const nodes = queryNodes(ctx.scope);
  return jsonResponse(extractLinks(nodes));
}

function handleStats(ctx: { scope: string }): Response {
  const nodes = queryNodes(ctx.scope);
  return jsonResponse(computeStats(nodes));
}

function handleConfigGet(): Response {
  return jsonResponse(readProjectConfig());
}

async function handleConfigSave(req: Request): Promise<Response> {
  const body = await req.text();
  memLog("debug", "api", "[api] Received body:", { body });
  const newConfig = JSON.parse(body) as Record<string, unknown>;
  const error = writeProjectConfig(newConfig);
  return jsonResponse({ success: error === "ok", error: error === "ok" ? null : error });
}

async function handleInject(req: Request): Promise<Response> {
  const body = await req.json() as { nodeId?: string; scope?: string };
  if (!body.nodeId) return jsonResponse({ success: false, error: "Missing nodeId" }, 400);

  const nodeId: string = body.nodeId;
  const injectScope = body.scope || "global";
  return withDb(injectScope, async (db) => {
    const exists = db.query("SELECT id FROM memory_nodes WHERE id = ?").get(nodeId);
    if (!exists) return jsonResponse({ success: false, error: "Node not found" }, 404);

    db.run("CREATE TABLE IF NOT EXISTS pending_injections (id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'global', source TEXT DEFAULT 'management', created_at TEXT NOT NULL DEFAULT (datetime('now')), processed INTEGER NOT NULL DEFAULT 0)");
    db.run("INSERT INTO pending_injections (node_id, scope, source) VALUES (?, ?, 'management')", [nodeId, injectScope]);

    memLog("info", "management", `[api] Queued node ${nodeId} for injection`);
    return jsonResponse({ success: true });
  });
}

async function handleSearch(ctx: { scope: string; url: URL }): Promise<Response> {
  const q = ctx.url.searchParams.get("q") || "";
  const mode = ctx.url.searchParams.get("mode") || "text";
  if (!q.trim()) return jsonResponse([]);

  return withDb(ctx.scope, async (db) => {
    if (mode === "text") {
      const rows = db.query(`
        SELECT id, label, content, summary, level, type, importance,
               usefulness_score, times_used, times_helpful, access_count,
               sticky, confidence, created_at, updated_at, parent_ids,
               LENGTH(content) as content_length, metadata
        FROM memory_nodes
        WHERE label LIKE ? OR content LIKE ?
        ORDER BY importance DESC
        LIMIT 100
      `).all(`%${q}%`, `%${q}%`) as any[];
      return jsonResponse(rows.map(r => ({ ...rowToNode(r), score: r.importance })));
    }

    if (mode === "embedding") {
      const queryEmbedding = await generateEmbedding(q);
      const rows = db.query(`
        SELECT id, label, content, summary, level, type, importance,
               usefulness_score, times_used, times_helpful, access_count,
               sticky, confidence, created_at, updated_at, parent_ids,
               LENGTH(content) as content_length, metadata, embedding_blob
        FROM memory_nodes
        WHERE embedding_blob IS NOT NULL
      `).all() as any[];

      const results = rows.map(r => {
        const floats = new Float32Array(r.embedding_blob.buffer, r.embedding_blob.byteOffset, r.embedding_blob.byteLength / 4);
        const embedding = Array.from(floats);
        return { ...rowToNode(r), score: cosineSimilarity(queryEmbedding, embedding) };
      });

      results.sort((a, b) => b.score - a.score);
      return jsonResponse(results.slice(0, 50));
    }

    if (mode === "bm25") {
      const terms = q.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(t => t.length >= 2);
      if (terms.length === 0) return jsonResponse([]);

      const placeholders = terms.map(() => "?").join(",");
      const rows = db.query(`
        SELECT n.id, n.label, n.content, n.summary, n.level, n.type, n.importance,
               n.usefulness_score, n.times_used, n.times_helpful, n.access_count,
               n.sticky, n.confidence, n.created_at, n.updated_at, n.parent_ids,
               LENGTH(n.content) as content_length, n.metadata,
               COALESCE(SUM(b.frequency), 0) as bm25_score
        FROM memory_nodes n
        INNER JOIN bm25_index b ON n.id = b.node_id
        WHERE b.term IN (${placeholders})
        GROUP BY n.id
        ORDER BY bm25_score DESC
        LIMIT 100
      `).all(...terms) as any[];
      return jsonResponse(rows.map(r => ({ ...rowToNode(r), score: r.bm25_score })));
    }

    return jsonResponse([]);
  });
}

async function handleNodeUpdate(req: Request, ctx: { params: Record<string, string>; scope: string }): Promise<Response> {
  const nodeId = ctx.params.id!;
  const body = await req.json() as Record<string, unknown>;

  return withDb(ctx.scope, async (db) => {
    const existing = db.query("SELECT content, label FROM memory_nodes WHERE id = ?").get(nodeId) as { content: string; label: string } | undefined;
    if (!existing) return jsonResponse({ success: false, error: "Node not found" }, 404);

    const newContent = (body.content as string) ?? existing.content;
    let embeddingBuffer: Buffer | null = null;

    if (body.content !== undefined && body.content !== existing.content) {
      memLog("info", "management", `[api] Regenerating embedding for node ${nodeId}`);
      const embedding = await generateEmbedding(newContent);
      embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (body.label !== undefined) { fields.push("label = ?"); values.push(String(body.label)); }
    if (body.content !== undefined) { fields.push("content = ?"); values.push(newContent); }
    if (body.summary !== undefined) { fields.push("summary = ?"); values.push(String(body.summary)); }
    if (body.level !== undefined) { fields.push("level = ?"); values.push(Number(body.level)); }
    if (body.importance !== undefined) { fields.push("importance = ?"); values.push(Number(body.importance)); }
    if (body.type !== undefined) { fields.push("type = ?"); values.push(String(body.type)); }
    if (body.sticky !== undefined) { fields.push("sticky = ?"); values.push(body.sticky ? 1 : 0); }
    if (body.confidence !== undefined) { fields.push("confidence = ?"); values.push(Number(body.confidence)); }
    if (body.usefulnessScore !== undefined) { fields.push("usefulness_score = ?"); values.push(Number(body.usefulnessScore)); }
    if (body.metadata !== undefined) { fields.push("metadata = ?"); values.push(JSON.stringify(body.metadata)); }
    if (embeddingBuffer) { fields.push("embedding_blob = ?"); values.push(embeddingBuffer); }

    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(nodeId);

    const sql = `UPDATE memory_nodes SET ${fields.join(", ")} WHERE id = ?`;
    db.run(sql, ...values);

    memLog("info", "management", `[api] Updated node ${nodeId}`);
    return jsonResponse({ success: true });
  });
}

async function handleNodeDelete(ctx: { params: Record<string, string>; scope: string }): Promise<Response> {
  const nodeId = ctx.params.id!;

  return withDb(ctx.scope, async (db) => {
    const existing = db.query("SELECT id FROM memory_nodes WHERE id = ?").get(nodeId);
    if (!existing) return jsonResponse({ success: false, error: "Node not found" }, 404);

    db.run("DELETE FROM memory_nodes WHERE id = ?", [nodeId]);
    memLog("info", "management", `[api] Deleted node ${nodeId}`);
    return jsonResponse({ success: true });
  });
}

function handleProjects(ctx: { scope: string }): Response {
  return jsonResponse(getAvailableProjects(ctx.scope));
}

function handleVersion(): Response {
  return jsonResponse({ version: VERSION });
}

export function registerRoutes(router: Router): void {
  router.get(/^\/api\/scopes$/, () => handleScopes());
  router.get(/^\/api\/version$/, () => handleVersion());
  router.get(/^\/api\/nodes$/, (_, ctx) => handleNodes(ctx));
  router.get(/^\/api\/links$/, (_, ctx) => handleLinks(ctx));
  router.get(/^\/api\/stats$/, (_, ctx) => handleStats(ctx));
  router.get(/^\/api\/projects$/, (_, ctx) => handleProjects(ctx));

  router.get(/^\/api\/config$/, () => handleConfigGet());
  router.put(/^\/api\/config$/, (req) => handleConfigSave(req));
  router.post(/^\/api\/config$/, (req) => handleConfigSave(req));

  router.post(/^\/api\/inject$/, (req) => handleInject(req));

  router.get(/^\/api\/search$/, (req, ctx) => handleSearch(ctx));

  router.put(/^\/api\/nodes\/(?<id>[^/]+)$/, (req, ctx) => handleNodeUpdate(req, ctx));
  router.patch(/^\/api\/nodes\/(?<id>[^/]+)$/, (req, ctx) => handleNodeUpdate(req, ctx));
  router.delete(/^\/api\/nodes\/(?<id>[^/]+)$/, (_, ctx) => handleNodeDelete(ctx));
}
