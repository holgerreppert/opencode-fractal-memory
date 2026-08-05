import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createSqliteMemoryStore } from "../../src/storage/sqlite";
import type { Conversation } from "./datasets/locomo";

export const LOCOMO_PROJECT_NAME = "locomo-seeded";

const DEFAULT_DATASET = path.resolve(__dirname, "./data/locomo10.json");
const TURN_EMBEDDINGS_CACHE = path.resolve(__dirname, "../../tests/dbs/locomo-seeded/turn-embeddings.bin");
const QA_EMBEDDINGS_CACHE = path.resolve(__dirname, "../../tests/dbs/locomo-seeded/qa-embeddings.json");

export type SeedLocomoOptions = {
  dataset?: string;
  /** Re-generate embeddings (deterministic ONNX) instead of using the committed cache. */
  regenerateEmbeddings?: boolean;
};

export type SeedLocomoResult = {
  dbPath: string;
  qaPath: string;
  turns: number;
  qas: number;
  elapsedMs: number;
};

/**
 * Fast deterministic LoCoMo seed: raw bulk insert (0.2s) + temporal edges +
 * BM25 backfill (~3s) + batched HNSW rebuild (~9s). Uses committed embedding
 * caches so results are reproducible and seeding takes ~15s, not ~4min.
 */
export async function seedLocomoDatabase(outDir: string, opts: SeedLocomoOptions = {}): Promise<SeedLocomoResult> {
  const datasetPath = opts.dataset ?? DEFAULT_DATASET;
  if (!fs.existsSync(datasetPath)) {
    throw new Error(
      `Dataset not found: ${datasetPath}\n` +
        `  Download it:\n` +
        `    curl -sL https://raw.githubusercontent.com/snap-research/LoCoMo/main/data/locomo10.json -o ${datasetPath}`,
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  const dbPath = path.join(outDir, "memory.db");
  const start = Date.now();

  const raw = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const conversations: Conversation[] = Array.isArray(raw) ? raw : (Object.values(raw) as Conversation[]);

  const turnTexts: string[] = [];
  for (const conv of conversations) {
    for (const turnsArr of Object.values(conv.conversation)) {
      if (!Array.isArray(turnsArr) || turnsArr.length === 0) continue;
      if (typeof turnsArr[0] !== "object" || !turnsArr[0] || !("dia_id" in turnsArr[0])) continue;
      for (const turn of turnsArr) {
        turnTexts.push(`${turn.speaker}: ${turn.text}`);
      }
    }
  }

  let turnEmbeddings: number[][];
  if (opts.regenerateEmbeddings || !fs.existsSync(TURN_EMBEDDINGS_CACHE)) {
    const { generateEmbeddings } = await import("../../src/infrastructure/llm/embeddings");
    turnEmbeddings = await generateEmbeddings(turnTexts);
    fs.mkdirSync(path.dirname(TURN_EMBEDDINGS_CACHE), { recursive: true });
    const buf = new Float32Array(turnEmbeddings.length * turnEmbeddings[0]!.length);
    let i = 0;
    for (const emb of turnEmbeddings) for (const v of emb) buf[i++] = v;
    fs.writeFileSync(TURN_EMBEDDINGS_CACHE, Buffer.from(buf.buffer));
  } else {
    const buf = new Float32Array(fs.readFileSync(TURN_EMBEDDINGS_CACHE).buffer);
    const dim = 384;
    turnEmbeddings = [];
    for (let i = 0; i < buf.length; i += dim) {
      turnEmbeddings.push(Array.from(buf.subarray(i, i + dim)));
    }
  }

  const qaEmbeddings: unknown[] = [];
  if (opts.regenerateEmbeddings || !fs.existsSync(QA_EMBEDDINGS_CACHE)) {
    const { generateEmbeddings } = await import("../../src/infrastructure/llm/embeddings");
    const qaEntries: Array<{ conversation: string; question: string; evidence: string[]; category: number }> = [];
    for (const conv of conversations) {
      for (const qa of conv.qa) {
        qaEntries.push({ conversation: conv.sample_id, question: qa.question, evidence: qa.evidence, category: qa.category });
      }
    }
    const embeddings = await generateEmbeddings(qaEntries.map(e => e.question));
    qaEmbeddings.push(...qaEntries.map((e, i) => ({ ...e, embedding: embeddings[i] })));
  }

  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  runMigrations(db);

  const now = Date.now();
  const insertNode = db.prepare(
    `INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, category, supertype, domain, tags, source, metadata, sticky, ttl_days, expires_at, confidence, verification_count, usefulness_score, times_used, times_helpful, project_name)
     VALUES (?, 'project', ?, ?, NULL, 0, NULL, NULL, ?, ?, ?, 0.5, 0, NULL, 'note', 'episodic', NULL, NULL, NULL, 'tool_result', NULL, 0, NULL, NULL, 0.5, 0, 0, 0, 0, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO temporal_edges (id, source_node_id, target_node_id, edge_type, scope, created_at, confidence, metadata)
     VALUES (?, ?, ?, ?, 'project', ?, 1.0, ?)`,
  );

  const nodeIds: string[] = [];
  const edges: Array<{ source: string; target: string; type: string; session: string }> = [];
  let turnIdx = 0;

  db.run("BEGIN");
  for (const conv of conversations) {
    const sampleId = conv.sample_id;
    const prevNodeIds: string[] = [];

    for (const [sessionKey, turnsArr] of Object.entries(conv.conversation)) {
      if (!Array.isArray(turnsArr) || turnsArr.length === 0) continue;
      if (typeof turnsArr[0] !== "object" || !turnsArr[0] || !("dia_id" in turnsArr[0])) continue;

      const summaryId = crypto.randomUUID();
      insertNode.run(
        summaryId,
        `${sampleId}-${sessionKey}-summary`,
        `Session ${sessionKey} conversation with ${turnsArr.length} turns.`,
        null,
        now,
        now,
        LOCOMO_PROJECT_NAME,
      );
      nodeIds.push(summaryId);

      for (const turn of turnsArr) {
        const nodeId = crypto.randomUUID();
        const embBlob = Buffer.from(new Float32Array(turnEmbeddings[turnIdx++]!).buffer);
        insertNode.run(
          nodeId,
          `${sampleId}-${turn.dia_id}`,
          `${turn.speaker}: ${turn.text}`,
          embBlob,
          now,
          now,
          LOCOMO_PROJECT_NAME,
        );
        nodeIds.push(nodeId);

        if (prevNodeIds.length > 0) {
          edges.push({ source: prevNodeIds[prevNodeIds.length - 1]!, target: nodeId, type: "NEXT", session: sessionKey });
        }
        prevNodeIds.push(nodeId);
        edges.push({ source: nodeId, target: summaryId, type: "DURING_SESSION", session: sessionKey });
      }
    }
  }

  for (const edge of edges) {
    insertEdge.run(crypto.randomUUID(), edge.source, edge.target, edge.type, now, JSON.stringify({ session: edge.session }));
  }
  db.run("COMMIT");
  db.close();

  const store = createSqliteMemoryStore(outDir, dbPath);
  await store.backfillBinaryEmbeddingsAndBM25("project");
  await store.rebuildHNSWIndex("project");
  await store.close();

  let qaCount = 0;
  const qaPath = path.join(outDir, "qa-embeddings.json");
  if (qaEmbeddings.length > 0) {
    fs.writeFileSync(qaPath, JSON.stringify(qaEmbeddings));
    qaCount = qaEmbeddings.length;
  } else if (fs.existsSync(QA_EMBEDDINGS_CACHE)) {
    fs.copyFileSync(QA_EMBEDDINGS_CACHE, qaPath);
    const cached = JSON.parse(fs.readFileSync(QA_EMBEDDINGS_CACHE, "utf-8")) as unknown[];
    qaCount = cached.length;
  } else {
    throw new Error(`No QA embeddings available: regenerate or provide ${QA_EMBEDDINGS_CACHE}`);
  }

  return {
    dbPath,
    qaPath,
    turns: turnIdx,
    qas: qaCount,
    elapsedMs: Date.now() - start,
  };
}
