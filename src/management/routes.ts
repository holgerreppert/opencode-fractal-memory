import { memLog } from "../logging";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import { Router } from "./router";
import type { IMemoryStore } from "../domain/ports/IMemoryStore";
import type { MemoryScope } from "../domain/ports/IMemoryStore";
import {
  readProjectConfig, writeProjectConfig,
  getAvailableScopes,
  extractLinks, computeStats,
  getBackupSources, createBackup, listBackups, deleteBackup, restoreBackup,
  getProjectDir,
} from "./helpers";
import { VERSION } from "../version";
import { CodeGraph } from "../application/graph/graph";
import { buildGraph, incrementalBuildGraph } from "../application/graph/build";
import { shortestPath, explain, searchNodes } from "../application/graph/query";
import { trackSearch, trackPath, trackExplain, trackExport, getGraphUsageStats } from "../application/graph/usage";
import type { BuildResult } from "../application/graph/build";

let cachedGraph: CodeGraph | null = null;
let cachedAnalysis: BuildResult | null = null;

export function registerRoutes(router: Router, store: IMemoryStore): void {
  // ==================== Scopes ====================
  router.get(/^\/api\/scopes$/, () => handleScopes());

  // ==================== Nodes ====================
  router.get(/^\/api\/nodes$/, async (_, ctx) => handleNodes(ctx, store));
  router.get(/^\/api\/links$/, async (_, ctx) => handleLinks(ctx, store));
  router.get(/^\/api\/temporal-edges$/, async (_, ctx) => handleTemporalEdges(ctx, store));
  router.get(/^\/api\/stats$/, async (_, ctx) => handleStats(ctx, store));
  router.get(/^\/api\/projects$/, async (req, ctx) => handleProjects(ctx, store));

  // ==================== Config ====================
  router.get(/^\/api\/config$/, () => handleConfigGet());
  router.put(/^\/api\/config$/, (req) => handleConfigSave(req));
  router.post(/^\/api\/config$/, (req) => handleConfigSave(req));

  // ==================== Inject ====================
  router.post(/^\/api\/inject$/, (req) => handleInject(req, store));

  // ==================== Search ====================
  router.get(/^\/api\/search$/, (req, ctx) => handleSearch(ctx, store));

  // ==================== Node CRUD ====================
  router.put(/^\/api\/nodes\/(?<id>[^/]+)$/, (req, ctx) => handleNodeUpdate(req, ctx, store));
  router.patch(/^\/api\/nodes\/(?<id>[^/]+)$/, (req, ctx) => handleNodeUpdate(req, ctx, store));
  router.delete(/^\/api\/nodes\/(?<id>[^/]+)$/, (_, ctx) => handleNodeDelete(ctx, store));

  // ==================== Compression Stats ====================
  router.get(/^\/api\/compress-stats$/, (req) => handleCompressionStats(req, store));

  // ==================== Token History ====================
  router.get(/^\/api\/token-history$/, (req) => handleTokenHistory(req, store));

  // ==================== Injection Quality ====================
  router.get(/^\/api\/injection-quality$/, (req) => handleInjectionQuality(req, store));

  // ==================== Context Dashboard ====================
  router.get(/^\/api\/context-dashboard$/, () => handleContextDashboard(store));

  // ==================== Version ====================
  router.get(/^\/api\/version$/, () => handleVersion());

  // ==================== Shutdown ====================
  router.get(/^\/api\/shutdown$/, () => handleShutdown());

  // ==================== Backup / Restore ====================
  router.get(/^\/api\/backup-sources$/, () => handleBackupSources());
  router.get(/^\/api\/backups$/, () => handleListBackups());
  router.post(/^\/api\/backup$/, (req) => handleCreateBackup(req));
  router.post(/^\/api\/restore$/, (req) => handleRestoreBackup(req));
  router.delete(/^\/api\/backups\/(?<name>[^/]+)$/, (_, ctx) => handleDeleteBackup(ctx));

  // ==================== Graph ====================
  router.post(/^\/api\/graph\/build$/, (req) => handleGraphBuild(req));
  router.get(/^\/api\/graph$/, () => handleGraphGet());
  router.get(/^\/api\/graph\/search$/, (req) => handleGraphSearch(req));
  router.post(/^\/api\/graph\/path$/, (req) => handleGraphPath(req));
  router.post(/^\/api\/graph\/explain$/, (req) => handleGraphExplain(req));
  router.get(/^\/api\/graph\/export$/, () => handleGraphExport());
  router.get(/^\/api\/graph\/usage$/, () => handleGraphUsage());
}

// ==================== Pure handlers (no store) ====================

function handleScopes(): Response {
  return jsonResponse(getAvailableScopes());
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

async function handleProjects(ctx: { scope: string }, store: IMemoryStore): Promise<Response> {
  const nodes = await store.listNodes(ctx.scope as MemoryScope);
  const projects = new Set<string>();
  for (const n of nodes) {
    projects.add(n.projectName || "(default)");
  }
  return jsonResponse([...projects].sort());
}

function handleVersion(): Response {
  return jsonResponse({ version: VERSION });
}

function handleShutdown(): Response {
  setTimeout(() => process.exit(0), 100);
  return jsonResponse({ ok: true, message: "shutting down" });
}

// ==================== Store-based handlers ====================

async function handleNodes(ctx: { scope: string; url: URL }, store: IMemoryStore): Promise<Response> {
  const projectName = ctx.url.searchParams.get("project_name") || undefined;
  const nodes = await store.listNodes(ctx.scope as MemoryScope, undefined, undefined, undefined, undefined, projectName);
  return jsonResponse(nodes.map(mapNode));
}

async function handleLinks(ctx: { scope: string; url: URL }, store: IMemoryStore): Promise<Response> {
  const projectName = ctx.url.searchParams.get("project_name") || undefined;
  const nodes = await store.listNodes(ctx.scope as MemoryScope, undefined, undefined, undefined, undefined, projectName);
  return jsonResponse(extractLinks(nodes.map(mapNode)));
}

async function handleTemporalEdges(ctx: { scope: string; url: URL }, store: IMemoryStore): Promise<Response> {
  const nodeId = ctx.url.searchParams.get("node_id") || undefined;
  const edges = await store.getTemporalEdges(nodeId ?? "", undefined, undefined, ctx.scope as MemoryScope);
  return jsonResponse(edges);
}

async function handleStats(ctx: { scope: string; url: URL }, store: IMemoryStore): Promise<Response> {
  const projectName = ctx.url.searchParams.get("project_name") || undefined;
  const nodes = await store.listNodes(ctx.scope as MemoryScope, undefined, undefined, undefined, undefined, projectName);
  const stats = computeStats(nodes.map(mapNode));

  // Fetch token, compression, and injection efficiency data in parallel
  const [compressStats, dashboardData, injectionMetrics] = await Promise.all([
    store.getCompressionStats(7, 5).catch(() => null),
    store.getContextDashboard().catch(() => null),
    store.getInjectionMetrics(100).catch(() => null),
  ]);

  if (dashboardData?.memory) {
    stats.memoryTokens = dashboardData.memory.totalTokens;
    stats.totalChars = dashboardData.memory.totalChars;
  }
  if (compressStats?.total) {
    stats.compressionCalls = compressStats.total.calls;
    stats.compressionSavings = compressStats.total.savingsPercent;
    stats.originalChars = compressStats.total.originalChars;
    stats.compressedChars = compressStats.total.compressedChars;
    stats.charsSaved = compressStats.total.originalChars - compressStats.total.compressedChars;
  }
  if (injectionMetrics && injectionMetrics.length > 0) {
    stats.injectionCount = injectionMetrics.length;
    stats.avgInjectionTokens = Math.round(
      injectionMetrics.reduce((s: number, m: any) => s + (m.injectedTokens || 0), 0) / injectionMetrics.length
    );
    const helpful = injectionMetrics.filter((m: any) => m.usefulnessScore > 0).length;
    stats.injectionHelpfulness = injectionMetrics.length > 0
      ? Math.round((helpful / injectionMetrics.length) * 100)
      : 0;
  }

  return jsonResponse(stats);
}

async function handleInject(req: Request, store: IMemoryStore): Promise<Response> {
  const body = await req.json() as { nodeId?: string; scope?: string };
  if (!body.nodeId) return jsonResponse({ success: false, error: "Missing nodeId" }, 400);
  try {
    await store.injectNode(body.nodeId, body.scope || "global");
    memLog("info", "management", `[api] Queued node ${body.nodeId} for injection`);
    return jsonResponse({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ success: false, error: msg }, msg === "Node not found" ? 404 : 500);
  }
}

async function handleSearch(ctx: { scope: string; url: URL }, store: IMemoryStore): Promise<Response> {
  const q = ctx.url.searchParams.get("q") || "";
  const mode = ctx.url.searchParams.get("mode") || "text";
  const scope = ctx.url.searchParams.get("scope") as MemoryScope | "all" | null;
  const queryScope = scope ?? ctx.scope as MemoryScope;
  if (!q.trim()) return jsonResponse([]);

  try {
    if (mode === "text") {
      const nodes = await store.searchText(queryScope, q, 100);
      return jsonResponse(nodes.map(n => ({ ...mapNode(n), score: n.importance })));
    }

    if (mode === "embedding") {
      const queryEmbedding = await generateEmbedding(q);
      const nodes = await store.searchByEmbedding(queryEmbedding, 50, { queryText: q });
      return jsonResponse(nodes.map(n => ({ ...mapNode(n), score: n.importance })));
    }

    if (mode === "bm25") {
      const nodes = await store.searchBM25(queryScope, q, 100);
      return jsonResponse(nodes.map(n => ({ ...mapNode(n), score: n.importance })));
    }

    return jsonResponse([]);
  } catch (e) {
    memLog("error", "management", "[api] Search error:", { error: e instanceof Error ? e.message : String(e) });
    return jsonResponse({ error: "Search failed" }, 500);
  }
}

async function handleNodeUpdate(req: Request, ctx: { params: Record<string, string>; scope: string }, store: IMemoryStore): Promise<Response> {
  const nodeId = ctx.params.id!;
  const body = await req.json() as Record<string, unknown>;

  try {
    const existing = await store.getNode(nodeId);
    const updates: Record<string, unknown> = {};

    if (body.label !== undefined) updates.label = String(body.label);
    if (body.content !== undefined) updates.content = String(body.content);
    if (body.summary !== undefined) updates.summary = String(body.summary);
    if (body.level !== undefined) updates.level = Number(body.level);
    if (body.importance !== undefined) updates.importance = Number(body.importance);
    if (body.type !== undefined) updates.type = String(body.type);
    if (body.sticky !== undefined) updates.sticky = Boolean(body.sticky);
    if (body.confidence !== undefined) updates.confidence = Number(body.confidence);
    if (body.usefulnessScore !== undefined) updates.usefulnessScore = Number(body.usefulnessScore);
    if (body.metadata !== undefined) updates.metadata = body.metadata;

    if (body.content !== undefined && body.content !== existing.content) {
      memLog("info", "management", `[api] Regenerating embedding for node ${nodeId}`);
      const embedding = await generateEmbedding(String(body.content));
      updates.embedding = embedding;
    }

    await store.updateNode(nodeId, updates as any);
    memLog("info", "management", `[api] Updated node ${nodeId}`);
    return jsonResponse({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ success: false, error: msg }, 404);
  }
}

async function handleNodeDelete(ctx: { params: Record<string, string>; scope: string }, store: IMemoryStore): Promise<Response> {
  const nodeId = ctx.params.id!;
  try {
    await store.getNode(nodeId); // verify exists
    await store.deleteNode(nodeId);
    memLog("info", "management", `[api] Deleted node ${nodeId}`);
    return jsonResponse({ success: true });
  } catch  {
    return jsonResponse({ success: false, error: "Node not found" }, 404);
  }
}

async function handleCompressionStats(req: Request, store: IMemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Math.min(parseInt(rawLimit, 10), 500) : 100;
  const days = parseInt(url.searchParams.get("days") ?? "7", 10);
  const stats = await store.getCompressionStats(days, limit);
  return jsonResponse(stats);
}

async function handleTokenHistory(req: Request, store: IMemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") ?? "30", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const history = await store.getTokenHistory(days, limit);
  return jsonResponse(history);
}

async function handleInjectionQuality(req: Request, store: IMemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  try {
    const metrics = await store.getInjectionMetrics(Math.min(limit, 500));
    return jsonResponse({ metrics });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleContextDashboard(store: IMemoryStore): Promise<Response> {
  return jsonResponse(await store.getContextDashboard());
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
    return jsonResponse({ success: true, preRestoreBackup: result.preRestoreBackup });
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

// ==================== Graph Handlers ====================

async function handleGraphBuild(_req: Request): Promise<Response> {
  memLog("info", "management", "[api] Building code graph...");
  try {
    const root = getProjectDir();
    const buildPromise = Promise.resolve().then(() => {
      if (cachedGraph) {
        return incrementalBuildGraph(cachedGraph, root);
      }
      return buildGraph(root);
    });
    const result = await Promise.race([
      buildPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Graph build timed out after 30s")), 30_000)),
    ]);
    cachedAnalysis = result;
    cachedGraph = result.graph;
    const analysis = result.analysis;
    memLog("info", "management", "[api] Graph build complete", {
      root,
      files: analysis.stats.files,
      symbols: analysis.stats.symbols,
      edges: analysis.stats.edges,
    });
    return jsonResponse({
      success: true,
      stats: analysis.stats,
      godNodes: analysis.godNodes.slice(0, 5).map(g => ({
        label: g.node.label,
        degree: g.degree,
        file: g.node.file,
        line: g.node.line,
      })),
      report: cachedAnalysis.report.slice(0, 2000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    memLog("error", "management", "[api] Graph build error:", { error: msg });
    return jsonResponse({ success: false, error: msg }, 500);
  }
}

function handleGraphGet(): Response {
  if (!cachedAnalysis) {
    return jsonResponse({ built: false, message: "No graph built yet. POST /api/graph/build to build one." });
  }
  const analysis = cachedAnalysis.analysis;
  return jsonResponse({
    built: true,
    stats: analysis.stats,
    godNodes: analysis.godNodes.map(g => ({
      label: g.node.label,
      degree: g.degree,
      file: g.node.file,
      line: g.node.line,
    })),
    surprisingConnections: analysis.surprisingConnections.map(sc => ({
      source: sc.source.label,
      target: sc.target.label,
      relation: sc.relation,
    })),
    suggestedQuestions: analysis.suggestedQuestions,
    report: cachedAnalysis.report,
    usage: getGraphUsageStats(),
  });
}

async function handleGraphSearch(req: Request): Promise<Response> {
  if (!cachedGraph) return jsonResponse({ error: "No graph built" }, 400);
  trackSearch("management");
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) return jsonResponse([]);
  return jsonResponse(searchNodes(cachedGraph, q));
}

async function handleGraphPath(req: Request): Promise<Response> {
  if (!cachedGraph) return jsonResponse({ error: "No graph built" }, 400);
  trackPath("management");
  const body = (await req.json()) as { from?: string; to?: string };
  if (!body.from || !body.to) return jsonResponse({ error: "Need 'from' and 'to' node IDs" }, 400);
  const result = shortestPath(cachedGraph, body.from, body.to);
  if (!result) return jsonResponse({ error: "No path found" }, 404);
  return jsonResponse(result);
}

async function handleGraphExplain(req: Request): Promise<Response> {
  if (!cachedGraph) return jsonResponse({ error: "No graph built" }, 400);
  trackExplain("management");
  const body = (await req.json()) as { id?: string };
  if (!body.id) return jsonResponse({ error: "Need node 'id'" }, 400);
  const result = explain(cachedGraph, body.id);
  if (!result) return jsonResponse({ error: "Node not found" }, 404);
  return jsonResponse(result);
}

function handleGraphUsage(): Response {
  return jsonResponse(getGraphUsageStats());
}

function handleGraphExport(): Response {
  if (!cachedGraph) return jsonResponse({ error: "No graph built" }, 400);
  trackExport("management");
  return new Response(JSON.stringify(cachedGraph.toJSON(), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": "attachment; filename=graph.json",
    },
  });
}

// ==================== Helpers ====================

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
}

function mapNode(n: any) {
  return {
    id: n.id,
    label: n.label || "",
    content: n.content,
    summary: n.summary,
    level: n.level,
    type: n.type,
    importance: n.importance,
    usefulnessScore: n.usefulnessScore,
    timesUsed: n.timesUsed,
    timesHelpful: n.timesHelpful,
    accessCount: n.accessCount,
    sticky: !!n.sticky,
    confidence: n.confidence,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    parentIds: n.parentIds ? (typeof n.parentIds === "string" ? JSON.parse(n.parentIds) : n.parentIds) : null,
    metadata: n.metadata ? (typeof n.metadata === "string" ? JSON.parse(n.metadata) : n.metadata) : null,
    projectName: n.projectName ?? null,
  };
}
