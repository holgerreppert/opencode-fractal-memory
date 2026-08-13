import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CodeGraph, type GraphJSON } from "./graph";
import { memLog } from "../../logging";

export const GRAPH_BATCH_SIZE = 100;

interface BatchWorkerOutput {
  graph: GraphJSON;
  stats: { processed: number; extractErrors: number };
}

function workerPath(): string {
  return fileURLToPath(new URL("./batch-worker.js", import.meta.url));
}

function resolveInterpreter(): string {
  if (typeof Bun !== "undefined") {
    const fromPath = Bun.which("bun");
    if (fromPath) return fromPath;
    if (process.execPath) return process.execPath;
  }
  return process.execPath || "node";
}

export function chunkFiles<T>(files: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < files.length; i += size) {
    chunks.push(files.slice(i, i + size));
  }
  return chunks;
}

export function spawnBatchWorker(batch: string[]): BatchWorkerOutput | null {
  if (batch.length === 0) return { graph: { nodes: [], edges: [] }, stats: { processed: 0, extractErrors: 0 } };
  try {
    const interp = resolveInterpreter();
    const worker = workerPath();
    const res = spawnSync(interp, [worker, JSON.stringify(batch)], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    if (res.status !== 0) {
      memLog("warn", "graph", "Batch worker failed", { status: res.status, stderr: String(res.stderr).slice(0, 300) });
      return null;
    }
    const stdout = String(res.stdout ?? "").trim();
    if (!stdout) {
      memLog("warn", "graph", "Batch worker produced no output", { batch: batch.length });
      return null;
    }
    const lastLine = stdout.split("\n").filter(Boolean).pop() ?? stdout;
    return JSON.parse(lastLine) as BatchWorkerOutput;
  } catch (e) {
    memLog("warn", "graph", "Batch worker spawn error", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export function mergeGraphJSON(target: CodeGraph, partial: GraphJSON): void {
  for (const n of partial.nodes) {
    if (!target.graph.hasNode(n.id)) {
      target.graph.addNode(n.id, n);
    }
  }
  for (const e of partial.edges) {
    target.addEdge(e.source, e.target, e.relation, e.confidence);
  }
  if (partial.fileHashes) {
    Object.assign(target.fileHashes, partial.fileHashes);
  }
}

export function extractInBatches(graph: CodeGraph, files: string[]): number {
  let extractErrors = 0;
  const chunks = chunkFiles(files, GRAPH_BATCH_SIZE);
  if (chunks.length === 0) return 0;
  let spawnedAny = false;
  for (const batch of chunks) {
    const out = spawnBatchWorker(batch);
    if (out) {
      mergeGraphJSON(graph, out.graph);
      extractErrors += out.stats.extractErrors;
      spawnedAny = true;
    } else {
      extractErrors += batch.length;
    }
  }
  if (!spawnedAny) {
    memLog("warn", "graph", "Graph extraction ran without successful subprocess batches", { batches: chunks.length });
  }
  return extractErrors;
}
