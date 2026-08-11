import { memLog } from "../../logging";
import { Router } from "../router";
import type { MemoryStore } from "../../domain/ports/MemoryStore";
import { jsonResponse } from "./common";

export function registerTelemetryRoutes(router: Router, store: MemoryStore): void {
  router.get(/^\/api\/compress-stats$/, (req) => handleCompressionStats(req, store));
  router.get(/^\/api\/token-history$/, (req) => handleTokenHistory(req, store));
  router.get(/^\/api\/injection-quality$/, (req) => handleInjectionQuality(req, store));
  router.get(/^\/api\/context-dashboard$/, () => handleContextDashboard(store));
  router.post(/^\/api\/inject$/, (req) => handleInject(req, store));
}

async function handleCompressionStats(req: Request, store: MemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Math.min(parseInt(rawLimit, 10), 500) : 100;
  const days = parseInt(url.searchParams.get("days") ?? "7", 10);
  const stats = await store.getCompressionStats(days, limit);
  return jsonResponse(stats);
}

async function handleTokenHistory(req: Request, store: MemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") ?? "30", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const history = await store.getTokenHistory(days, limit);
  return jsonResponse(history);
}

async function handleInjectionQuality(req: Request, store: MemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  try {
    const metrics = await store.getInjectionMetrics(Math.min(limit, 500));
    return jsonResponse({ metrics });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleContextDashboard(store: MemoryStore): Promise<Response> {
  return jsonResponse(await store.getContextDashboard());
}

async function handleInject(req: Request, store: MemoryStore): Promise<Response> {
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
