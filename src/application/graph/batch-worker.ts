import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CodeGraph, type GraphJSON } from "./graph";
import { extractFile, type WasmModule } from "./extract";
import { memLog } from "../../logging";

interface BatchWorkerOutput {
  graph: GraphJSON;
  stats: { processed: number; extractErrors: number };
}

function main(): void {
  const batch = JSON.parse(process.argv[2] ?? "[]") as string[];
  if (batch.length === 0) {
    console.log(JSON.stringify({ graph: { nodes: [], edges: [] }, stats: { processed: 0, extractErrors: 0 } }));
    return;
  }
  const req = createRequire(import.meta.url);
  const mod = req("@kreuzberg/tree-sitter-language-pack-wasm") as WasmModule;
  const graph = new CodeGraph();
  let processed = 0;
  let extractErrors = 0;
  for (const file of batch) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (content.length < 100) continue;
    processed++;
    try {
      extractFile(file, content, mod, graph);
      graph.markExtracted(file, content);
    } catch {
      extractErrors++;
    }
  }
  const out: BatchWorkerOutput = { graph: graph.toJSON(), stats: { processed, extractErrors } };
  console.log(JSON.stringify(out));
  memLog("info", "graph-batch-worker", "batch complete", { processed, extractErrors });
}

// Only run as a script (spawned subprocess); no-op when imported.
if (process.argv[1] && process.argv[2]) {
  try {
    main();
  } catch (e) {
    memLog("error", "graph-batch-worker", "batch failed", { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  }
}