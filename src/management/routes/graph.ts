import { basename } from "node:path";
import { memLog } from "../../logging";
import { Router } from "../router";
import { getProjectDir, getProjectName } from "../helpers";
import { buildGraph, incrementalBuildGraph, type BuildResult } from "../../application/graph/build";
import { analyze } from "../../application/graph/analyze";
import { generateReport } from "../../application/graph/report";
import { loadGraphCache, listCachedGraphs } from "../../application/graph/persist";
import { shortestPath, explain, searchNodes } from "../../application/graph/query";
import { trackSearch, trackPath, trackExplain, trackExport, getGraphUsageStats, readPluginGraphUsage, type GraphUsageStats } from "../../application/graph/usage";
import { jsonResponse } from "./common";

// Per-project graph state (keyed by project root), so the management app can
// view/build the code graph for ANY project — not just the current one.
interface ProjectGraph { root: string; result: BuildResult; }
const projectGraphs = new Map<string, ProjectGraph>();

export function registerGraphRoutes(router: Router): void {
  router.get(/^\/api\/graph\/projects$/, () => handleGraphProjects());
  router.post(/^\/api\/graph\/build$/, (req) => handleGraphBuild(req));
  router.get(/^\/api\/graph$/, (req) => handleGraphGet(req));
  router.get(/^\/api\/graph\/search$/, (req) => handleGraphSearch(req));
  router.post(/^\/api\/graph\/path$/, (req) => handleGraphPath(req));
  router.post(/^\/api\/graph\/explain$/, (req) => handleGraphExplain(req));
  router.get(/^\/api\/graph\/export$/, (req) => handleGraphExport(req));
  router.get(/^\/api\/graph\/usage$/, () => handleGraphUsage());
}

function projectParam(req: Request): string | null {
  const url = new URL(req.url);
  const p = url.searchParams.get("project");
  return p && p.trim() !== "" ? p.trim() : null;
}

// Resolve a project name to its root directory: current project via env/cwd,
// other projects via the persisted graph cache inventory.
function resolveProjectRoot(projectName: string | null): string | null {
  const current = getProjectDir();
  if (!projectName) return current;
  if (projectName === basename(current) || projectName === getProjectName()) return current;
  const match = listCachedGraphs().find((c) => basename(c.root) === projectName);
  return match ? match.root : null;
}

// Load (from the in-memory map, else from the persisted plugin graph cache) and
// prepare the analysis for a project. Returns null when nothing is available.
function getOrLoadProject(projectName: string | null): ProjectGraph | null {
  const root = resolveProjectRoot(projectName);
  if (!root) return null;
  const hit = projectGraphs.get(root);
  if (hit) return hit;
  const cached = loadGraphCache(root);
  if (!cached) return null;
  const analysis = analyze(cached);
  const result: BuildResult = {
    graph: cached,
    analysis,
    report: generateReport(analysis),
    fileCount: analysis.stats.files,
    symbolCount: analysis.stats.symbols,
    edgeCount: analysis.stats.edges,
    newFiles: 0,
  };
  projectGraphs.set(root, { root, result });
  return projectGraphs.get(root)!;
}

// Dropdown inventory: the current project first, then every project that has a
// persisted graph (i.e. a session was run there).
function handleGraphProjects(): Response {
  const current = getProjectDir();
  const currentName = getProjectName();
  const seen = new Set<string>([currentName]);
  const currentCached = loadGraphCache(current);
  const currentInfo = listCachedGraphs().find((c) => c.root === current);
  const items: Array<{
    projectName: string;
    root: string;
    built: boolean;
    savedAt: number | null;
    nodes: number;
    edges: number;
  }> = [{
    projectName: currentName,
    root: current,
    built: projectGraphs.has(current) || currentCached !== null,
    savedAt: currentInfo?.savedAt ?? null,
    nodes: currentCached?.nodeCount() ?? currentInfo?.nodes ?? 0,
    edges: currentCached?.edgeCount() ?? currentInfo?.edges ?? 0,
  }];
  for (const c of listCachedGraphs()) {
    const name = basename(c.root);
    if (seen.has(name)) continue;
    seen.add(name);
    items.push({
      projectName: name,
      root: c.root,
      built: true,
      savedAt: c.savedAt,
      nodes: c.nodes,
      edges: c.edges,
    });
  }
  return jsonResponse(items);
}

async function handleGraphBuild(req: Request): Promise<Response> {
  const projectName = projectParam(req);
  const root = resolveProjectRoot(projectName);
  if (!root) {
    return jsonResponse({ success: false, error: `Project "${projectName ?? ""}" not resolvable — no persisted graph cache for it` }, 400);
  }
  memLog("info", "management", "[api] Building code graph", { project: projectName ?? "(current)", root });
  try {
    const existing = projectGraphs.get(root);
    const buildPromise = Promise.resolve().then(() => {
      if (existing) {
        return incrementalBuildGraph(existing.result.graph, root);
      }
      const cached = loadGraphCache(root);
      if (cached) {
        return incrementalBuildGraph(cached, root);
      }
      return buildGraph(root);
    });
    const result = await Promise.race([
      buildPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Graph build timed out after 30s")), 30_000)),
    ]);
    projectGraphs.set(root, { root, result });
    const analysis = result.analysis;
    memLog("info", "management", "[api] Graph build complete", {
      project: projectName ?? "(current)",
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
      report: result.report.slice(0, 2000),
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

function handleGraphGet(req: Request): Response {
  const loaded = getOrLoadProject(projectParam(req));
  if (!loaded) {
    return jsonResponse({ built: false, message: "No graph built yet for this project. Click \"Build Code Graph\" to start." });
  }
  const analysis = loaded.result.analysis;
  return jsonResponse({
    built: true,
    projectName: basename(loaded.root),
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
    report: loaded.result.report,
    usage: getMergedGraphUsage(),
  });
}

async function handleGraphSearch(req: Request): Promise<Response> {
  const loaded = getOrLoadProject(projectParam(req));
  if (!loaded) return jsonResponse({ error: "No graph built" }, 400);
  trackSearch("management");
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) return jsonResponse([]);
  return jsonResponse(searchNodes(loaded.result.graph, q));
}

async function handleGraphPath(req: Request): Promise<Response> {
  const loaded = getOrLoadProject(projectParam(req));
  if (!loaded) return jsonResponse({ error: "No graph built" }, 400);
  trackPath("management");
  const body = (await req.json()) as { from?: string; to?: string };
  if (!body.from || !body.to) return jsonResponse({ error: "Need 'from' and 'to' node IDs" }, 400);
  const result = shortestPath(loaded.result.graph, body.from, body.to);
  if (!result) return jsonResponse({ error: "No path found" }, 404);
  return jsonResponse(result);
}

async function handleGraphExplain(req: Request): Promise<Response> {
  const loaded = getOrLoadProject(projectParam(req));
  if (!loaded) return jsonResponse({ error: "No graph built" }, 400);
  trackExplain("management");
  const body = (await req.json()) as { id?: string };
  if (!body.id) return jsonResponse({ error: "Need node 'id'" }, 400);
  const result = explain(loaded.result.graph, body.id);
  if (!result) return jsonResponse({ error: "Node not found" }, 404);
  return jsonResponse(result);
}

function handleGraphUsage(): Response {
  return jsonResponse(getMergedGraphUsage());
}

function handleGraphExport(req: Request): Response {
  const loaded = getOrLoadProject(projectParam(req));
  if (!loaded) return jsonResponse({ error: "No graph built" }, 400);
  trackExport("management");
  return new Response(JSON.stringify(loaded.result.graph.toJSON(), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": "attachment; filename=graph.json",
    },
  });
}