import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CodeGraph } from "./graph";
import { findCodeFiles } from "./detect";
import { detectCommunities } from "./cluster";
import { analyze, type AnalysisResult } from "./analyze";
import { generateReport } from "./report";
import { trackBuild, trackBackgroundBuild } from "./usage";
import { memLog, writeGraphLog } from "../../logging";
import { extractInBatches } from "./batching";
import { loadGraphCache, saveGraphCache } from "./persist";

export interface BuildResult {
  graph: CodeGraph;
  analysis: AnalysisResult;
  report: string;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  newFiles: number;
}

/** Files/dirs whose presence marks a directory as a real project root. */
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "bun.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
];

/** Roots that are never a project — indexing them walks the whole machine. */
const BLOCKED_ROOTS = new Set(["/", "/home", "/tmp"]);

export interface GraphRootCheck {
  ok: boolean;
  /** Real (symlink-resolved) path of the candidate root. */
  root: string;
  reason?: string;
}

function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Decide whether `root` is safe to index.
 *
 * The runtime hands the plugin the *location* directory, which for a global install can
 * be `$HOME`. A full AST walk of `$HOME` never finishes and keeps the CLI's
 * background service from becoming ready (endless restart loop), so refuse
 * anything that is the home directory, one of its ancestors, a world-writable
 * scratch root, or a directory with no project marker at all.
 */
export function checkGraphRoot(root: string): GraphRootCheck {
  const resolved = realPath(root);
  const home = realPath(homedir());

  if (resolved === home) {
    return { ok: false, root: resolved, reason: "home directory" };
  }
  if (BLOCKED_ROOTS.has(resolved)) {
    return { ok: false, root: resolved, reason: "system/scratch root" };
  }
  if (home === resolved || home.startsWith(resolved + path.sep)) {
    return { ok: false, root: resolved, reason: "ancestor of the home directory" };
  }
  const markers = PROJECT_MARKERS.filter((marker) => existsSync(path.join(resolved, marker)));
  if (markers.length === 0) {
    return { ok: false, root: resolved, reason: "no project marker" };
  }
  return { ok: true, root: resolved };
}

function emptyBuildResult(): BuildResult {
  const graph = new CodeGraph();
  const analysis = analyze(graph);
  return {
    graph,
    analysis,
    report: generateReport(analysis),
    fileCount: 0,
    symbolCount: 0,
    edgeCount: 0,
    newFiles: 0,
  };
}

export function buildGraph(root: string, maxFiles = 5_000): BuildResult {
  const guard = checkGraphRoot(root);
  if (!guard.ok) {
    memLog("info", "graph", "buildGraph skipped", { root: guard.root, reason: guard.reason });
    return emptyBuildResult();
  }
  const rssMB = (): number => Math.round(process.memoryUsage().rss / 1024 / 1024);
  memLog("info", "graph", "buildGraph start", { root: guard.root, rssMB: rssMB() });
  const graph = new CodeGraph();
  const files = findCodeFiles(guard.root);
  memLog("info", "graph", "findCodeFiles result", { root: guard.root, totalFound: files.length, sample: files.slice(0, 10).map(f => f.replace(guard.root, "")).join(", "), rssMB: rssMB() });
  const toProcess = files.slice(0, maxFiles);

  let readErrors = 0;
  let tooSmall = 0;
  let skippedUnchanged = 0;
  const pending: string[] = [];
  for (const file of toProcess) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      readErrors++;
      continue;
    }
    if (content.length < 100) { tooSmall++; continue; }
    if (!graph.isNewOrChanged(file, content)) {
      skippedUnchanged++;
      continue;
    }
    pending.push(file);
  }
  memLog("info", "graph", "buildGraph files selected", { total: toProcess.length, pending: pending.length, readErrors, tooSmall, skippedUnchanged, rssMB: rssMB() });
  const extractErrors = extractInBatches(graph, pending);
  memLog("info", "graph", "buildGraph after extract", { pending: pending.length, extractErrors, rssMB: rssMB() });

  if (skippedUnchanged > 0) {
    memLog("info", "graph", "Incremental build", { skippedUnchanged, processed: toProcess.length - skippedUnchanged, total: toProcess.length });
  }

  detectCommunities(graph);
  const analysis = analyze(graph);
  const report = generateReport(analysis);

  memLog("info", "graph", "Build diagnostics", { totalFound: files.length, readErrors, tooSmall, extractErrors, skippedUnchanged, fileNodes: analysis.stats.files, symbolNodes: analysis.stats.symbols, rssMB: rssMB() });
  writeGraphLog("info", "Graph built", {
    stats: analysis.stats,
    godNodes: analysis.godNodes.map(n => `${n.node.label}(${n.node.kind}):${n.degree}`),
    surprisingConnections: analysis.surprisingConnections.slice(0, 10).map(c => `${c.source.label}(${c.source.kind}) --${c.relation}-> ${c.target.label}(${c.target.kind})`),
  });
  trackBuild(analysis.stats.files, analysis.stats.symbols, analysis.stats.edges, "buildGraph");
  saveGraphCache(guard.root, graph);

  return {
    graph,
    analysis,
    report,
    fileCount: analysis.stats.files,
    symbolCount: analysis.stats.symbols,
    edgeCount: analysis.stats.edges,
    newFiles: pending.length,
  };
}

export function incrementalBuildGraph(existingGraph: CodeGraph, root: string, maxFiles = 5_000): BuildResult {
  const files = findCodeFiles(root);
  const toProcess = files.slice(0, maxFiles);

  let readErrors = 0;
  let tooSmall = 0;
  let skippedUnchanged = 0;
  let newFiles = 0;
  const pending: string[] = [];
  for (const file of toProcess) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      readErrors++;
      continue;
    }
    if (content.length < 100) { tooSmall++; continue; }
    if (!existingGraph.isNewOrChanged(file, content)) {
      skippedUnchanged++;
      continue;
    }
    newFiles++;
    pending.push(file);
  }
  const extractErrors = extractInBatches(existingGraph, pending);

  if (skippedUnchanged > 0 || newFiles > 0) {
    memLog("info", "graph", "Incremental build", { newFiles, skippedUnchanged, total: toProcess.length });
  }

  if (!existingGraph.communitiesDetected) {
    detectCommunities(existingGraph);
    existingGraph.markCommunitiesDetected();
  }

  const analysis = analyze(existingGraph);
  const report = generateReport(analysis);

  memLog("info", "graph", "Incremental build diagnostics", { newFiles, skippedUnchanged, readErrors, tooSmall, extractErrors, fileNodes: analysis.stats.files, symbolNodes: analysis.stats.symbols });
  writeGraphLog("info", "Graph incremental build", {
    newFiles,
    stats: analysis.stats,
    godNodes: analysis.godNodes.slice(0, 10).map(n => `${n.node.label}(${n.node.kind}):${n.degree}`),
  });
  trackBuild(analysis.stats.files, analysis.stats.symbols, analysis.stats.edges, "incrementalBuildGraph");
  if (newFiles > 0) saveGraphCache(root, existingGraph);

  return {
    graph: existingGraph,
    analysis,
    report,
    fileCount: analysis.stats.files,
    symbolCount: analysis.stats.symbols,
    edgeCount: analysis.stats.edges,
    newFiles,
  };
}

export function refreshGraphFile(filePath: string, content: string): void {
  const graph = getActiveGraph();
  if (!graph || content.length < 100) return;
  try {
    // Route through a subprocess batch too: loading WASM in opencode's process even for
    // single files recreates the accumulation bug across many distinct edits in a session.
    extractInBatches(graph, [filePath]);
  } catch {
    // single-file re-extract failed silently — will be picked up by idle rebuild
  }
}

let backgroundGraph: CodeGraph | null = null;
let activeGraph: CodeGraph | null = null;
let backgroundBuildPromise: Promise<void> | null = null;

export function getBackgroundGraph(): CodeGraph | null {
  return backgroundGraph;
}

export function getActiveGraph(): CodeGraph | null {
  return activeGraph ?? backgroundGraph;
}

export function ensureBackgroundGraph(root: string, maxFiles = 5_000): void {
  const guard = checkGraphRoot(root);
  if (!guard.ok) {
    memLog("info", "graph", "ensureBackgroundGraph skipped", { root: guard.root, reason: guard.reason });
    return;
  }
  const rssMB = (): number => Math.round(process.memoryUsage().rss / 1024 / 1024);
  trackBackgroundBuild("ensureBackgroundGraph");
  memLog("info", "graph", "ensureBackgroundGraph start", { hasGraph: !!backgroundGraph, rssMB: rssMB() });
  if (backgroundGraph) {
    // temp-swap: clone → incremental on clone → atomic swap only on success (no partial mutation)
    try {
      const clone = CodeGraph.fromJSON(backgroundGraph.toJSON());
      const result = incrementalBuildGraph(clone, guard.root, maxFiles);
      backgroundGraph = clone;
      activeGraph = clone;
      memLog("info", "graph", "Background incremental build (temp-swap)", { newFiles: result.newFiles, skippedUnchanged: result.fileCount, symbols: result.symbolCount, rssMB: rssMB() });
    } catch {
      // incremental build failed — keep existing graph, no partial mutation (temp discarded)
    }
    return;
  }
  const cached = loadGraphCache(guard.root);
  if (cached) {
    // temp-swap from cache: incremental on clone, swap only on success
    try {
      const clone = CodeGraph.fromJSON(cached.toJSON());
      const result = incrementalBuildGraph(clone, guard.root, maxFiles);
      backgroundGraph = clone;
      activeGraph = clone;
      memLog("info", "graph", "Background build from cache (temp-swap)", { newFiles: result.newFiles, skippedUnchanged: result.fileCount, symbols: result.symbolCount, edges: result.edgeCount, rssMB: rssMB() });
      return;
    } catch {
      // cached incremental build failed — fall back to full rebuild (no assignment)
    }
  }
  if (backgroundBuildPromise) return;
  backgroundBuildPromise = (async () => {
    try {
      const result = buildGraph(guard.root, maxFiles);
      backgroundGraph = result.graph;
      activeGraph = backgroundGraph;
      memLog("info", "graph", "ensureBackgroundGraph done", { fileCount: result.fileCount, symbolCount: result.symbolCount, rssMB: rssMB() });
    } catch {
      // background build failed silently — will retry on explicit call
    }
  })();
}
