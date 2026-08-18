import { memLog } from "../../logging";
import { Router } from "../router";
import type { MemoryStore } from "../../domain/ports/MemoryStore";
import { jsonResponse } from "./common";

export function registerTelemetryRoutes(router: Router, store: MemoryStore): void {
  router.get(/^\/api\/compress-stats$/, (req) => handleCompressionStats(req, store));
  router.get(/^\/api\/token-history$/, (req) => handleTokenHistory(req, store));
  router.get(/^\/api\/injection-quality$/, (req) => handleInjectionQuality(req, store));
  router.get(/^\/api\/context-dashboard$/, () => handleContextDashboard(store));
  router.get(/^\/api\/context-pressure$/, (req) => handleContextPressure(req, store));
  router.get(/^\/api\/context-archive$/, (req) => handleContextArchive(req, store));
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

async function handleContextPressure(req: Request, store: MemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") ?? "30", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "500", 10);
  const entries = await store.getContextPressure(days, Math.min(limit, 2000));
  return jsonResponse({ entries });
}

// Archived-context registry: every contexthistory node (index + history chain).
// The index node content is JSON {entries: [{ref, msgId, status, summary, label, topic}]}.
async function handleContextArchive(req: Request, store: MemoryStore): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const nodes = await store.listNodes("all", undefined, 500, 0, true);
  const history = nodes.filter((n) => n.type === "contexthistory" && n.label?.startsWith("contexthistory:"));
  const indexes = history.filter((n) => n.label?.includes(":index:"));
  const chains = history.filter((n) => !n.label?.includes(":index:"));

  let entries: Array<{ ref: string; msgId?: string; status?: string; summary?: string; label?: string; topic?: string }> = [];
  for (const idx of indexes) {
    if (sessionId && !idx.label?.includes(sessionId)) continue;
    try {
      const parsed = JSON.parse(idx.content ?? "{}") as { entries?: Array<Record<string, unknown>> };
      if (Array.isArray(parsed.entries)) {
        for (const e of parsed.entries) {
          const entry: { ref: string; msgId?: string; status?: string; summary?: string; label?: string; topic?: string } = { ref: String(e.ref ?? "") };
          if (e.msgId !== undefined) entry.msgId = String(e.msgId);
          if (e.status !== undefined) entry.status = String(e.status);
          if (e.summary !== undefined) entry.summary = String(e.summary);
          if (e.label !== undefined) entry.label = String(e.label);
          if (e.topic !== undefined) entry.topic = String(e.topic);
          entries.push(entry);
        }
      }
    } catch { /* skip unparseable index */ }
  }
  // Order newest-first by node id sequence (labels are contexthistory:<session>:<n>).
  const chainsSorted = chains.sort((a, b) => ((b.label ?? "").localeCompare(a.label ?? "")));
  return jsonResponse({
    totalIndexes: indexes.length,
    totalChains: chains.length,
    entries: entries.slice(0, 500),
    chains: chainsSorted.slice(0, 100).map((n) => ({
      id: n.id,
      label: n.label,
      contentLength: n.content?.length ?? 0,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  });
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
