import { memLog } from "../logging";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import { Router } from "./router";
import { cosineSimilarity } from "../math";
import {
  queryNodes, getAvailableScopes, extractLinks, computeStats,
  readProjectConfig, writeProjectConfig, rowToNode,
  withDb, jsonResponse, getAvailableProjects, queryTemporalEdges,
  getBackupSources, createBackup, listBackups, deleteBackup, restoreBackup,
} from "./helpers";
import { VERSION } from "../version";
import { queryInjectionMetrics } from "../storage/injection-events";
import type { SqliteNode } from "../storage/queries/base";

function handleScopes(): Response {
  return jsonResponse(getAvailableScopes());
}

function handleNodes(ctx: { scope: string; url: URL }): Response {
  const projectName = ctx.url.searchParams.get("project_name") || undefined;
  return jsonResponse(queryNodes(ctx.scope, projectName));
}

function handleLinks(ctx: { scope: string; url: URL }): Response {
  const projectName = ctx.url.searchParams.get("project_name") || undefined;
  const nodes = queryNodes(ctx.scope, projectName);
  return jsonResponse(extractLinks(nodes));
}

function handleTemporalEdges(ctx: { scope: string; url: URL }): Response {
  const projectName = ctx.url.searchParams.get("project_name") || undefined;
  const nodeId = ctx.url.searchParams.get("node_id") || undefined;
  return jsonResponse(queryTemporalEdges(ctx.scope, projectName, nodeId));
}

function handleStats(ctx: { scope: string; url: URL }): Response {
  const projectName = ctx.url.searchParams.get("project_name") || undefined;
  const nodes = queryNodes(ctx.scope, projectName);
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
      `).all(`%${q}%`, `%${q}%`) as SqliteNode[];
      return jsonResponse(rows.map((r: SqliteNode) => ({ ...rowToNode(r), score: r.importance })));
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
      `).all() as SqliteNode[];

      const results = rows.map((r: SqliteNode) => {
        const blob = r.embedding_blob!;
      const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
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
      `).all(...terms) as Array<SqliteNode & { bm25_score: number }>;
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
    db.run("DELETE FROM memory_links WHERE source_id = ?", [nodeId]);
    db.run("DELETE FROM temporal_edges WHERE source_node_id = ? OR target_node_id = ?", [nodeId, nodeId]);
    db.run("DELETE FROM bm25_index WHERE node_id = ?", [nodeId]);
    db.run("DELETE FROM bm25_doc_stats WHERE node_id = ?", [nodeId]);
    memLog("info", "management", `[api] Deleted node ${nodeId} with associated links, edges, and BM25 index`);
    return jsonResponse({ success: true });
  });
}

function handleProjects(ctx: { scope: string }): Response {
  return jsonResponse(getAvailableProjects(ctx.scope));
}

function handleVersion(): Response {
  return jsonResponse({ version: VERSION });
}

function handleShutdown(): Response {
  // Respond first, then die — gives the caller time to receive the response
  setTimeout(() => process.exit(0), 100);
  return jsonResponse({ ok: true, message: "shutting down" });
}

async function handleInjectionQuality(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  return withDb("global", async (db) => {
    try {
      const metrics = queryInjectionMetrics(db, Math.min(limit, 500));
      return jsonResponse({ metrics });
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}

// ==================== Backup / Restore Handlers ====================

function handleBackupSources(): Response {
  return jsonResponse(getBackupSources());
}

async function handleCreateBackup(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { sources?: string[]; label?: string };
    if (!body.sources || !Array.isArray(body.sources) || body.sources.length === 0) {
      return jsonResponse({ success: false, error: "No sources provided" }, 400);
    }
    const result = await createBackup(body.sources, body.label);
    if (result.error) return jsonResponse({ success: false, error: result.error }, 400);
    return jsonResponse({ success: true, backup: result });
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleListBackups(): Promise<Response> {
  try {
    const backups = await listBackups();
    return jsonResponse({ backups });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleRestoreBackup(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { backup?: string; sources?: string[] };
    if (!body.backup) return jsonResponse({ success: false, error: "Missing backup name" }, 400);
    if (!body.sources || !Array.isArray(body.sources) || body.sources.length === 0) {
      return jsonResponse({ success: false, error: "No sources to restore" }, 400);
    }
    const result = await restoreBackup(body.backup, body.sources);
    if (!result.success) return jsonResponse({ success: false, error: result.error }, 400);
    return jsonResponse({
      success: true,
      preRestoreBackup: result.preRestoreBackup,
    });
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleDeleteBackup(ctx: { params: Record<string, string> }): Promise<Response> {
  const name = ctx.params.name;
  if (!name) return jsonResponse({ success: false, error: "Missing backup name" }, 400);
  const result = await deleteBackup(name);
  if (!result.success) return jsonResponse({ success: false, error: result.error }, 404);
  return jsonResponse({ success: true });
}

async function handleCompressionStats(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Math.min(parseInt(rawLimit, 10), 500) : 100;
  const days = parseInt(url.searchParams.get("days") ?? "7", 10);
  const since = Date.now() - days * 86400000;

  return withDb("global", (db) => {
    const total = db.query("SELECT COUNT(*) as c, SUM(original_chars) as raw, SUM(compressed_chars) as comp FROM compression_stats WHERE timestamp >= ?").get(since) as { c: number; raw: number; comp: number } | undefined;
    const byStrategy = db.query(
      "SELECT strategy, COUNT(*) as calls, SUM(original_chars) as raw, SUM(compressed_chars) as comp, ROUND(AVG(savings_ratio) * 100, 1) as avg_savings FROM compression_stats WHERE timestamp >= ? GROUP BY strategy ORDER BY calls DESC"
    ).all(since) as Array<{ strategy: string; calls: number; raw: number; comp: number; avg_savings: number }>;
    const byCommand = db.query(
      "SELECT command, COUNT(*) as calls, SUM(original_chars) as raw, SUM(compressed_chars) as comp FROM compression_stats WHERE timestamp >= ? GROUP BY command ORDER BY calls DESC LIMIT ?"
    ).all(since, limit) as Array<{ command: string; calls: number; raw: number; comp: number }>;
    const recent = db.query(
      "SELECT timestamp, command, strategy, original_chars, compressed_chars, original_lines, compressed_lines, cmd_preview, original_preview, compressed_preview, savings_ratio, duration_ms FROM compression_stats WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 20"
    ).all(since) as Array<{ timestamp: number; command: string; strategy: string; original_chars: number; compressed_chars: number; original_lines: number; compressed_lines: number; cmd_preview: string; original_preview: string; compressed_preview: string; savings_ratio: number; duration_ms: number }>;

    return jsonResponse({
      total: {
        calls: total?.c ?? 0,
        originalChars: total?.raw ?? 0,
        compressedChars: total?.comp ?? 0,
        savingsPercent: total?.raw ? Math.round((1 - (total?.comp ?? 0) / (total?.raw ?? 1)) * 100) : 0,
      },
      byStrategy,
      byCommand: byCommand.slice(0, limit),
      recent: recent.slice(0, 20).map((r: any) => ({
        timestamp: r.timestamp,
        command: r.command,
        strategy: r.strategy,
        originalChars: r.original_chars,
        compressedChars: r.compressed_chars,
        originalLines: r.original_lines ?? null,
        compressedLines: r.compressed_lines ?? null,
        cmdPreview: r.cmd_preview ?? null,
        originalPreview: r.original_preview ?? null,
        compressedPreview: r.compressed_preview ?? null,
        durationMs: r.duration_ms ?? null,
        savingsRatio: r.savings_ratio,
      })),
    });
  });
}

async function handleContextDashboard(_req: Request): Promise<Response> {
  return withDb("global", (db) => {
    const nodesByLevel = db.query(
      "SELECT level, COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM memory_nodes WHERE scope = 'global' GROUP BY level ORDER BY level"
    ).all() as { level: number; count: number; total_chars: number | null }[];

    const nodesByType = db.query(
      "SELECT type, COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM memory_nodes WHERE scope = 'global' GROUP BY type ORDER BY count DESC"
    ).all() as { type: string; count: number; total_chars: number | null }[];

    const ruleCount = (db.query(
      "SELECT COUNT(*) as count FROM memory_nodes WHERE label LIKE 'rule:%'"
    ).get() as { count: number })?.count ?? 0;

    const totalNodes = (db.query(
      "SELECT COUNT(*) as count FROM memory_nodes WHERE scope = 'global'"
    ).get() as { count: number })?.count ?? 0;

    const totalChars = (db.query(
      "SELECT SUM(LENGTH(content)) as total FROM memory_nodes WHERE scope = 'global'"
    ).get() as { total: number | null })?.total ?? 0;

    const compressTotal = db.query(
      "SELECT COUNT(*) as calls, SUM(original_chars) as raw, SUM(compressed_chars) as comp FROM compression_stats"
    ).get() as { calls: number; raw: number | null; comp: number | null } | undefined;

    const recentInjections = queryInjectionMetrics(db, 5);

    const totalMemoryTokens = nodesByLevel.reduce((s, r) => s + ((r.total_chars ?? 0) / 4), 0);

    const compressedSavings = compressTotal && compressTotal.raw
      ? Math.round((1 - (compressTotal.comp ?? 0) / (compressTotal.raw ?? 1)) * 100)
      : 0;

    return jsonResponse({
      memory: {
        totalNodes,
        totalTokens: Math.round(totalMemoryTokens),
        totalChars,
        byLevel: nodesByLevel.map(r => ({
          level: r.level,
          count: r.count,
          tokens: Math.round((r.total_chars ?? 0) / 4),
        })),
        byType: nodesByType.map(r => ({
          type: r.type,
          count: r.count,
          tokens: Math.round((r.total_chars ?? 0) / 4),
        })),
        rules: ruleCount,
      },
      compression: {
        totalCalls: compressTotal?.calls ?? 0,
        originalChars: compressTotal?.raw ?? 0,
        compressedChars: compressTotal?.comp ?? 0,
        savingsPercent: compressedSavings,
      },
      injections: recentInjections.map(m => ({
        sessionId: m.sessionId,
        timestamp: m.timestamp,
        nodeCount: m.injectedNodeCount,
        tokens: m.injectedTokens,
        mode: m.injectionMode,
        strategy: m.rerankStrategy,
      })),
      overhead: {
        systemPromptTokens: 3000,
        toolDefTokens: 4000,
      },
    });
  });
}

export function registerRoutes(router: Router): void {
  router.get(/^\/api\/scopes$/, () => handleScopes());
  router.get(/^\/api\/version$/, () => handleVersion());
  router.get(/^\/api\/shutdown$/, () => handleShutdown());
  router.get(/^\/api\/nodes$/, (_, ctx) => handleNodes(ctx));
  router.get(/^\/api\/links$/, (_, ctx) => handleLinks(ctx));
  router.get(/^\/api\/temporal-edges$/, (_, ctx) => handleTemporalEdges(ctx));
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

  // Compression stats route
  router.get(/^\/api\/compress-stats$/, (req) => handleCompressionStats(req));

  // Injection quality route
  router.get(/^\/api\/injection-quality$/, (req) => handleInjectionQuality(req));

  // Context dashboard
  router.get(/^\/api\/context-dashboard$/, (req) => handleContextDashboard(req));

  // Backup / Restore routes
  router.get(/^\/api\/backup-sources$/, () => handleBackupSources());
  router.get(/^\/api\/backups$/, () => handleListBackups());
  router.post(/^\/api\/backup$/, (req) => handleCreateBackup(req));
  router.post(/^\/api\/restore$/, (req) => handleRestoreBackup(req));
  router.delete(/^\/api\/backups\/(?<name>[^/]+)$/, (_, ctx) => handleDeleteBackup(ctx));
}
