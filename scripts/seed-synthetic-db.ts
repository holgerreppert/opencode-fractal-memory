import * as fs from "node:fs";
import * as path from "node:path";
import { createSqliteMemoryStore } from "../src/storage/sqlite";
import type { MemoryStore } from "../src/storage/types";
import { generateEmbedding } from "../src/embeddings";
import { NODES, QAS, TEMPORAL_EDGES } from "./benchmark/datasets/synthetic";

const DEFAULT_OUT = "tests/dbs/synthetic-seeded";
const SAMPLE_ARG_INDEX = process.argv.indexOf("--sample");
const SAMPLE = SAMPLE_ARG_INDEX >= 0 ? parseInt(process.argv[SAMPLE_ARG_INDEX + 1] ?? "0", 10) : 0;

type QaEmbeddingEntry = {
  question: string;
  evidence: string[];
  category: number;
  embedding: number[];
};

async function seed(): Promise<void> {
  const outDir = path.resolve(DEFAULT_OUT);
  fs.mkdirSync(outDir, { recursive: true });

  const dbPath = path.join(outDir, "memory.db");
  const store = createSqliteMemoryStore(outDir, dbPath);
  await store.ensureSeed();

  console.log(`Seeding ${NODES.length} synthetic nodes...`);
  const startTime = Date.now();

  const labelToId = new Map<string, string>();

  for (let i = 0; i < NODES.length; i++) {
    const def = NODES[i]!;
    const embedding = await generateEmbedding(def.content);
    const node = await store.createNode({
      scope: "project",
      label: def.label,
      content: def.content,
      type: def.type as any,
      level: 0,
      embedding,
      importance: def.importance,
    });
    labelToId.set(def.label, node.id);

    if ((i + 1) % 20 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  [${elapsed}s] ${i + 1}/${NODES.length} nodes...`);
    }
  }

  console.log(`Creating ${TEMPORAL_EDGES.length} temporal edges...`);
  for (const edge of TEMPORAL_EDGES) {
    const sourceId = labelToId.get(edge.sourceLabel);
    const targetId = labelToId.get(edge.targetLabel);
    if (sourceId && targetId) {
      await store.createTemporalEdge(sourceId, targetId, edge.edgeType, "project", 1.0, null);
    }
  }

  const qaEmbeddings: QaEmbeddingEntry[] = [];
  const qaSlice = SAMPLE > 0 ? QAS.slice(0, SAMPLE) : QAS;

  console.log(`Generating embeddings for ${qaSlice.length} QA pairs...`);
  for (let i = 0; i < qaSlice.length; i++) {
    const qa = qaSlice[i]!;
    const embedding = await generateEmbedding(qa.question);
    qaEmbeddings.push({
      question: qa.question,
      evidence: qa.evidence,
      category: qa.category,
      embedding,
    });
    if ((i + 1) % 30 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  [${elapsed}s] ${i + 1}/${qaSlice.length} QA embeddings...`);
    }
  }

  console.log(`\nRebuilding HNSW index and BM25...`);
  await store.rebuildHNSWIndex("project");
  await store.backfillBinaryEmbeddingsAndBM25("project");

  const qaPath = path.join(outDir, "qa-embeddings.json");
  fs.writeFileSync(qaPath, JSON.stringify(qaEmbeddings, null, 0));
  console.log(`QA embeddings saved to ${qaPath}`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Seed complete ===`);
  console.log(`  Nodes:      ${NODES.length}`);
  console.log(`  QA pairs:   ${qaEmbeddings.length}`);
  console.log(`  Edges:      ${TEMPORAL_EDGES.length}`);
  console.log(`  Database:   ${dbPath}`);
  console.log(`  Time:       ${elapsed}s`);

  await store.close();
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
