import * as fs from "node:fs";
import * as path from "node:path";
import { createSqliteMemoryStore } from "../src/storage/sqlite";
import type { MemoryStore, MemoryNode } from "../src/storage/types";
import { generateEmbedding } from "../src/embeddings";
import { CATEGORY_LABELS } from "./benchmark/datasets/locomo";
import type { Conversation, QAPair } from "./benchmark/datasets/locomo";

const DEFAULT_DATASET = "scripts/benchmark/data/locomo10.json";
const DEFAULT_OUT = "tests/dbs/locomo-seeded";

type QaEmbeddingEntry = {
  conversation: string;
  question: string;
  evidence: string[];
  category: number;
  embedding: number[];
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
  };
  return {
    dataset: get("--dataset", DEFAULT_DATASET),
    out: get("--out", DEFAULT_OUT),
    sample: parseInt(get("--sample", "0"), 10),
  };
}

async function seed(): Promise<void> {
  const config = parseArgs();

  if (!fs.existsSync(config.dataset)) {
    console.error(`Dataset not found: ${config.dataset}`);
    console.error("Download it:");
    console.error(`  curl -sL https://raw.githubusercontent.com/snap-research/LoCoMo/main/data/locomo10.json -o ${config.dataset}`);
    process.exit(1);
  }

  const outDir = path.resolve(config.out);
  fs.mkdirSync(outDir, { recursive: true });

  const dbPath = path.join(outDir, "memory.db");
  const store = createSqliteMemoryStore(outDir, dbPath);
  await store.ensureSeed();

  console.log(`Loading dataset: ${config.dataset}`);
  const raw = JSON.parse(fs.readFileSync(config.dataset, "utf-8"));
  const conversations: Conversation[] = Array.isArray(raw) ? raw : Object.values(raw) as Conversation[];
  console.log(`Loaded ${conversations.length} conversations\n`);

  const qaEmbeddings: QaEmbeddingEntry[] = [];
  let totalTurns = 0;
  let totalQas = 0;
  const startTime = Date.now();

  for (const conv of conversations) {
    const sampleId = conv.sample_id;
    const prevNodeIds: string[] = [];

    for (const [sessionKey, turns] of Object.entries(conv.conversation)) {
      if (!Array.isArray(turns) || turns.length === 0) continue;
      if (typeof turns[0] !== "object" || !turns[0] || !("dia_id" in turns[0])) continue;

      const summaryContent = `Session ${sessionKey} conversation with ${turns.length} turns.`;
      const summaryNode = await store.createNode({
        scope: "project",
        label: `${sampleId}-${sessionKey}-summary`,
        content: summaryContent,
        type: "note",
        level: 0,
        embedding: null,
        importance: 0.5,
        metadata: { sampleId, session: sessionKey, turnCount: turns.length, isSessionSummary: true },
      });

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i] as { speaker: string; dia_id: string; text: string };
        const label = `${sampleId}-${turn.dia_id}`;
        const content = `${turn.speaker}: ${turn.text}`;

        const embedding = await generateEmbedding(turn.text);
        const node = await store.createNode({
          scope: "project",
          label,
          content,
          type: "note",
          level: 0,
          embedding,
          metadata: {
            sampleId,
            session: sessionKey,
            turnId: turn.dia_id,
            turnIndex: i,
          },
          importance: 0.5,
        });

        if (prevNodeIds.length > 0) {
          await store.createTemporalEdge(prevNodeIds[prevNodeIds.length - 1], node.id, "NEXT", "project", 1.0, { session: sessionKey });
        }
        prevNodeIds.push(node.id);
        await store.createTemporalEdge(node.id, summaryNode.id, "DURING_SESSION", "project", 1.0, { session: sessionKey });

        totalTurns++;
        if (totalTurns % 500 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          console.log(`  [${elapsed}s] ${totalTurns} turns ingested...`);
        }
      }
    }

    const sample = config.sample > 0 ? Math.min(config.sample, conv.qa.length) : conv.qa.length;
    for (let qi = 0; qi < sample && qi < conv.qa.length; qi++) {
      const qa = conv.qa[qi]!;
      const embedding = await generateEmbedding(qa.question);
      qaEmbeddings.push({
        conversation: sampleId,
        question: qa.question,
        evidence: qa.evidence,
        category: qa.category,
        embedding,
      });
      totalQas++;
      if (totalQas % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  [${elapsed}s] ${totalQas} QA embeddings generated...`);
      }
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
  console.log(`  Turns:      ${totalTurns}`);
  console.log(`  QA pairs:   ${totalQas}`);
  console.log(`  Database:   ${outDir}/memory.db`);
  console.log(`  Time:       ${elapsed}s`);

  await store.close();
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
