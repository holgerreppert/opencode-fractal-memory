import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { CodeGraph } from "./graph";
import { findCodeFiles } from "./detect";
import { extractFile, logExtractDiagnostics, resetExtractDiagnostics } from "./extract";
import { detectCommunities } from "./cluster";
import { analyze, type AnalysisResult } from "./analyze";
import { generateReport } from "./report";
import { trackBuild, trackBackgroundBuild } from "./usage";
import { memLog } from "../../logging";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WasmModule = any;

let wasmMod: WasmModule | null = null;

function getWasm(): WasmModule {
  if (!wasmMod) {
    const req = createRequire(import.meta.url);
    wasmMod = req("@kreuzberg/tree-sitter-language-pack-wasm");
  }
  return wasmMod;
}

export interface BuildResult {
  graph: CodeGraph;
  analysis: AnalysisResult;
  report: string;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
}


export function buildGraph(root: string, maxFiles = 5_000): BuildResult {
  const graph = new CodeGraph();
  const files = findCodeFiles(root);
  memLog("info", "graph", "findCodeFiles result", { root, totalFound: files.length, sample: files.slice(0, 10).map(f => f.replace(root, "")).join(", ") });
  const toProcess = files.slice(0, maxFiles);
  const mod = getWasm();

  let readErrors = 0;
  let tooSmall = 0;
  let extractErrors = 0;
  let skippedUnchanged = 0;
  resetExtractDiagnostics();
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
    try {
      extractFile(file, content, mod, graph);
      graph.markExtracted(file, content);
    } catch {
      extractErrors++;
      continue;
    }
  }
  logExtractDiagnostics();

  if (skippedUnchanged > 0) {
    memLog("info", "graph", "Incremental build", { skippedUnchanged, processed: toProcess.length - skippedUnchanged, total: toProcess.length });
  }

  detectCommunities(graph);
  const analysis = analyze(graph);
  const report = generateReport(analysis);

  memLog("info", "graph", "Build diagnostics", { totalFound: files.length, readErrors, tooSmall, extractErrors, skippedUnchanged, fileNodes: analysis.stats.files, symbolNodes: analysis.stats.symbols });
  trackBuild(analysis.stats.files, analysis.stats.symbols, analysis.stats.edges, "buildGraph");

  return {
    graph,
    analysis,
    report,
    fileCount: analysis.stats.files,
    symbolCount: analysis.stats.symbols,
    edgeCount: analysis.stats.edges,
  };
}

export function incrementalBuildGraph(existingGraph: CodeGraph, root: string, maxFiles = 5_000): BuildResult {
  const files = findCodeFiles(root);
  const toProcess = files.slice(0, maxFiles);
  const mod = getWasm();

  let readErrors = 0;
  let tooSmall = 0;
  let extractErrors = 0;
  let skippedUnchanged = 0;
  let newFiles = 0;
  resetExtractDiagnostics();
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
    try {
      extractFile(file, content, mod, existingGraph);
      existingGraph.markExtracted(file, content);
    } catch {
      extractErrors++;
      continue;
    }
  }
  logExtractDiagnostics();

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
  trackBuild(analysis.stats.files, analysis.stats.symbols, analysis.stats.edges, "incrementalBuildGraph");

  return {
    graph: existingGraph,
    analysis,
    report,
    fileCount: analysis.stats.files,
    symbolCount: analysis.stats.symbols,
    edgeCount: analysis.stats.edges,
  };
}

let backgroundGraph: CodeGraph | null = null;
let backgroundBuildPromise: Promise<void> | null = null;

export function getBackgroundGraph(): CodeGraph | null {
  return backgroundGraph;
}

export function ensureBackgroundGraph(root: string, maxFiles = 5_000): void {
  trackBackgroundBuild("ensureBackgroundGraph");
  if (backgroundGraph) {
    try {
      const result = incrementalBuildGraph(backgroundGraph, root, maxFiles);
      memLog("info", "graph", "Background incremental build", { newFiles: result.fileCount, symbols: result.symbolCount });
    } catch {
      // incremental build failed — fall back to full rebuild
    }
    return;
  }
  if (backgroundBuildPromise) return;
  backgroundBuildPromise = (async () => {
    try {
      const result = buildGraph(root, maxFiles);
      backgroundGraph = result.graph;
    } catch {
      // background build failed silently — will retry on explicit call
    }
  })();
}
