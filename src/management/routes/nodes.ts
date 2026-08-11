import { memLog } from "../../logging";
import { generateEmbeddingWithSegments } from "../../infrastructure/llm/embeddings";
import { Router } from "../router";
import type { MemoryStore } from "../../domain/ports/MemoryStore";
import type { MemoryScope } from "../../domain/ports/MemoryStore";
import {
  extractLinks, computeStats, getProjectName,
} from "../helpers";
import { jsonResponse, mapNode } from "./common";

export function registerNodeRoutes(router: Router, store: MemoryStore): void {
  router.get(/^\/api\/nodes$/, async (_, ctx) => handleNodes(ctx, store));
  router.get(/^\/api\/links$/, async (_, ctx) => handleLinks(ctx, store));
  router.get(/^\/api\/temporal-edges$/, async (_, ctx) => handleTemporalEdges(ctx, store));
  router.get(/^\/api\/stats$/, async (_, ctx) => handleStats(ctx, store));
  router.get(/^\/api\/projects$/, async (req, ctx) => handleProjects(ctx, store));
  router.get(/^\/api\/search$/, (req, ctx) => handleSearch(ctx, store));
  router.put(/^\/api\/nodes\/(?<id>[^/]+)$/, (req, ctx) => handleNodeUpdate(req, ctx, store));
  router.patch(/^\/api\/nodes\/(?<id>[^/]+)$/, (req, ctx) => handleNodeUpdate(req, ctx, store));
  router.post(/^\/api\/nodes\/(?<id>[^/]+)\/verify$/, async (_, ctx) => handleNodeVerify(ctx, store));
  router.delete(/^\/api\/nodes\/(?<id>[^/]+)$/, (_, ctx) => handleNodeDelete(ctx, store));
}

async function handleNodes(ctx: { scope: string; url: URL }, store: MemoryStore): Promise<Response> {
  const url = ctx.url;
  const projectName = url.searchParams.get("project_name") || undefined;
  const limit = parseInt(url.searchParams.get("limit") || "10000", 10);
  const nodes = await store.listNodes(ctx.scope as MemoryScope, undefined, limit, undefined, undefined, projectName);
  return jsonResponse(nodes.map(mapNode));
}

async function handleLinks(ctx: { scope: string; url: URL }, store: MemoryStore): Promise<Response> {
  const url = ctx.url;
  const projectName = url.searchParams.get("project_name") || undefined;
  const limit = parseInt(url.searchParams.get("limit") || "10000", 10);
  const nodes = await store.listNodes(ctx.scope as MemoryScope, undefined, limit, undefined, undefined, projectName);
  return jsonResponse(extractLinks(nodes.map(mapNode)));
}

async function handleTemporalEdges(ctx: { scope: string; url: URL }, store: MemoryStore): Promise<Response> {
  const nodeId = ctx.url.searchParams.get("node_id") || undefined;
  const edges = await store.getTemporalEdges(nodeId ?? "", undefined, undefined, ctx.scope as MemoryScope);
  return jsonResponse(edges);
}

async function handleStats(ctx: { scope: string; url: URL }, store: MemoryStore): Promise<Response> {
  const url = ctx.url;
  const projectName = url.searchParams.get("project_name") || undefined;
  const limit = parseInt(url.searchParams.get("limit") || "10000", 10);
  const nodes = await store.listNodes(ctx.scope as MemoryScope, undefined, limit, undefined, undefined, projectName);
  const stats = computeStats(nodes.map(mapNode));

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
      injectionMetrics.reduce((s: number, m: { injectedTokens?: number }) => s + (m.injectedTokens || 0), 0) / injectionMetrics.length
    );
    const helpful = injectionMetrics.filter(m => (m.effectivenessScore ?? 0) > 0).length;
    stats.injectionHelpfulness = injectionMetrics.length > 0
      ? Math.round((helpful / injectionMetrics.length) * 100)
      : 0;
  }

  return jsonResponse(stats);
}

async function handleProjects(ctx: { scope: string; url: URL }, store: MemoryStore): Promise<Response> {
  const url = ctx.url;
  const limit = parseInt(url.searchParams.get("limit") || "10000", 10);
  const nodes = await store.listNodes(ctx.scope as MemoryScope, undefined, limit);
  const projects = new Set<string>();
  for (const n of nodes) {
    if (n.projectName && n.projectName.startsWith("auto-edges-test-")) continue;
    projects.add(n.projectName || "(default)");
  }
  return jsonResponse([...projects].sort());
}

async function handleSearch(ctx: { scope: string; url: URL }, store: MemoryStore): Promise<Response> {
  const q = ctx.url.searchParams.get("q") || "";
  const mode = ctx.url.searchParams.get("mode") || "hybrid";
  const scope = ctx.url.searchParams.get("scope") as MemoryScope | "all" | null;
  const queryScope = scope ?? ctx.scope as MemoryScope;
  const projectName = queryScope === "project" ? getProjectName() : undefined;
  if (!q.trim()) return jsonResponse([]);

  try {
    const { searchNodes } = await import("../../application/search");
    const { generateEmbedding } = await import("../../infrastructure/llm/embeddings");
    const opts: { limit: number; mode: "hybrid" | "bm25" | "text"; scope: MemoryScope | "all"; projectName?: string | undefined } = {
      limit: 100,
      mode: (mode === "embedding" ? "hybrid" : mode) as "hybrid" | "bm25" | "text",
      scope: queryScope,
    };
    if (projectName !== undefined) opts.projectName = projectName;
    const nodes = await searchNodes(store, generateEmbedding, q, opts);
    return jsonResponse(nodes.map(n => ({ ...mapNode(n), score: n.importance })));
  } catch (e) {
    memLog("error", "management", "[api] Search error:", { error: e instanceof Error ? e.message : String(e) });
    return jsonResponse({ error: "Search failed" }, 500);
  }
}

async function handleNodeUpdate(req: Request, ctx: { params: Record<string, string>; scope: string }, store: MemoryStore): Promise<Response> {
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
    if (body.domain !== undefined) updates.domain = String(body.domain);
    if (body.sticky !== undefined) updates.sticky = Boolean(body.sticky);
    if (body.confidence !== undefined) updates.confidence = Number(body.confidence);
    if (body.usefulnessScore !== undefined) updates.usefulnessScore = Number(body.usefulnessScore);
    if (body.metadata !== undefined) updates.metadata = body.metadata;

    if (body.content !== undefined && body.content !== existing.content) {
      memLog("info", "management", `[api] Regenerating embedding for node ${nodeId}`);
      const { primary, segments } = await generateEmbeddingWithSegments(String(body.content));
      updates.embedding = primary;
      updates.embeddingSegments = segments;
    }

    await store.updateNode(nodeId, updates as Parameters<typeof store.updateNode>[1]);
    memLog("info", "management", `[api] Updated node ${nodeId}`);
    return jsonResponse({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ success: false, error: msg }, 404);
  }
}

async function handleNodeDelete(ctx: { params: Record<string, string>; scope: string }, store: MemoryStore): Promise<Response> {
  const nodeId = ctx.params.id!;
  try {
    await store.getNode(nodeId);
    await store.deleteNode(nodeId);
    memLog("info", "management", `[api] Deleted node ${nodeId}`);
    return jsonResponse({ success: true });
  } catch  {
    return jsonResponse({ success: false, error: "Node not found" }, 404);
  }
}

async function handleNodeVerify(ctx: { params: Record<string, string>; scope: string }, store: MemoryStore): Promise<Response> {
  const nodeId = ctx.params.id!;
  try {
    const node = await store.verifyNode(nodeId);
    memLog("info", "management", `[api] Verified node ${nodeId}`);
    return jsonResponse({ success: true, node: mapNode(node) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ success: false, error: msg }, 404);
  }
}
