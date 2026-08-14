import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { CodeGraph, type GraphJSON } from "./graph";
import { memLog, writeGraphLog } from "../../logging";

const CACHE_DIR = join(homedir(), ".config", "opencode", "graph-cache");

let cacheEnabled = true;

export function setGraphCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled;
}

function cachePathFor(root: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(CACHE_DIR, `${hash}.json`);
}

interface GraphCacheFile {
  version: 1;
  root: string;
  savedAt: number;
  graph: GraphJSON;
}

export function saveGraphCache(root: string, graph: CodeGraph): boolean {
  if (!cacheEnabled) return false;
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    const target = cachePathFor(root);
    const tmp = `${target}.tmp`;
    const payload: GraphCacheFile = {
      version: 1,
      root,
      savedAt: Date.now(),
      graph: graph.toJSON(),
    };
    writeFileSync(tmp, JSON.stringify(payload), "utf-8");
    renameSync(tmp, target);
    return true;
  } catch (err) {
    memLog("warn", "graph", "saveGraphCache failed", { error: String(err) });
    return false;
  }
}

export function loadGraphCache(root: string): CodeGraph | null {
  if (!cacheEnabled) return null;
  try {
    const target = cachePathFor(root);
    if (!existsSync(target)) return null;
    const raw = readFileSync(target, "utf-8");
    const payload = JSON.parse(raw) as GraphCacheFile;
    if (payload.version !== 1 || payload.root !== root) return null;
    const graph = CodeGraph.fromJSON(payload.graph);
    if (graph.nodeCount() < 10) return null;
    memLog("info", "graph", "loadGraphCache hit", {
      root,
      nodes: graph.nodeCount(),
      edges: graph.edgeCount(),
      hashedFiles: Object.keys(graph.fileHashes).length,
      savedAt: new Date(payload.savedAt).toISOString(),
    });
    writeGraphLog("info", "Graph cache loaded", {
      nodes: graph.nodeCount(),
      edges: graph.edgeCount(),
      savedAt: new Date(payload.savedAt).toISOString(),
    });
    return graph;
  } catch (err) {
    memLog("warn", "graph", "loadGraphCache failed, ignoring", { error: String(err) });
    return null;
  }
}
