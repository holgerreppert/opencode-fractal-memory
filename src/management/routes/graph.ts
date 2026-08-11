import { memLog } from "../../logging";
import { Router } from "../router";
import { getProjectDir } from "../helpers";
import { CodeGraph } from "../../application/graph/graph";
import { buildGraph, incrementalBuildGraph, type BuildResult } from "../../application/graph/build";
import { shortestPath, explain, searchNodes } from "../../application/graph/query";
import { trackSearch, trackPath, trackExplain, trackExport, getGraphUsageStats, readPluginGraphUsage, type GraphUsageStats } from "../../application/graph/usage";
import { jsonResponse } from "./common";

let cachedGraph: CodeGraph | null = null;
let cachedAnalysis: BuildResult | null = null;

export function registerGraphRoutes(router: Router): void {
  router.post(/^\/api\/graph\/build$/, (req) => handleGraphBuild(req));
  router.get(/^\/api\/graph$/, () => handleGraphGet());
  router.get(/^\/api\/graph\/search$/, (req) => handleGraphSearch(req));
  router.post(/^\/api\/graph\/path$/, (req) => handleGraphPath(req));
  router.post(/^\/api\/graph\/explain$/, (req) => handleGraphExplain(req));
  router.get(/^\/api\/graph\/export$/, () => handleGraphExport());
  router.get(/^\/api\/graph\/usage$/, () => handleGraphUsage());
}

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

function getMergedGraphUsage(): GraphUsageStats {
  const mgmtStats = getGraphUsageStats();
  const pluginStats = readPluginGraphUsage();
  if (pluginStats) {
    mgmtStats.readAnnotations = pluginStats.readAnnotations;
    mgmtStats.fileRefreshes = pluginStats.fileRefreshes;
    mgmtStats.backgroundBuilds.count += pluginStats.backgroundBuilds.count;
  }
  return mgmtStats;
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
    usage: getMergedGraphUsage(),
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
  return jsonResponse(getMergedGraphUsage());
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
