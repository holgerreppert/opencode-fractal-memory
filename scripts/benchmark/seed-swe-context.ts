import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/storage/migrations";
import { createSqliteMemoryStore } from "../../src/storage/sqlite";
import { loadExperienceTasks, loadRelatedTasks, type ExperienceTask } from "./datasets/swe-context";

export const SWE_CONTEXT_PROJECT_NAME = "swe-contextbench";

const DATA_DIR = path.resolve(__dirname, "../../tests/dbs/swe-contextbench");
const EXPERIENCE_EMBEDDINGS_CACHE = path.resolve(__dirname, "../../tests/dbs/swe-contextbench/experience-embeddings.bin");
const RELATED_EMBEDDINGS_CACHE = path.resolve(__dirname, "../../tests/dbs/swe-contextbench/related-embeddings.json");

export type SeedSweContextOptions = {
  /** Re-generate embeddings (deterministic ONNX) instead of using the committed cache. */
  regenerateEmbeddings?: boolean;
};

export type SeedSweContextResult = {
  dbPath: string;
  experiences: number;
  related: number;
  elapsedMs: number;
};

function embeddingBlob(emb: number[]): Buffer {
  return Buffer.from(new Float32Array(emb).buffer);
}

function contentForExperience(exp: ExperienceTask): string {
  const parts: string[] = [];
  if (exp.reasoning) parts.push(`Reasoning: ${exp.reasoning}`);
  if (exp.summary) parts.push(`Summary: ${exp.summary}`);
  if (exp.problem_statement) parts.push(`Issue: ${exp.problem_statement}`);
  if (exp.tool_sequence.length > 0) {
    parts.push(
      `Trajectory: ${exp.tool_sequence.map(t => `${t.name}(${t.target})`).join(" -> ")}`,
    );
  }
  if (exp.touched_files.length > 0) parts.push(`Files touched: ${exp.touched_files.join(", ")}`);
  return parts.join("\n\n");
}

/**
 * Fast deterministic SWE-ContextBench Lite seed: bulk insert of 300 experience
 * task nodes (trajectory-derived: summary + issue + touched files) with temporal
 * edges to per-file nodes, BM25 backfill, and batched HNSW rebuild. Uses committed
 * embedding caches so results are reproducible without network or ~2min of ONNX.
 */
export async function seedSweContextDatabase(outDir: string, opts: SeedSweContextOptions = {}): Promise<SeedSweContextResult> {
  if (!fs.existsSync(path.join(DATA_DIR, "experience.json"))) {
    throw new Error(
      `SWE-ContextBench dataset not found in ${DATA_DIR}\n` +
        `  Fetch it:\n` +
        `    bun run scripts/benchmark/fetch-swe-context.ts`,
    );  }

  fs.mkdirSync(outDir, { recursive: true });
  const dbPath = path.join(outDir, "memory.db");
  const start = Date.now();

  const experiences = loadExperienceTasks(DATA_DIR).filter(e => e.instance_id);
  const related = loadRelatedTasks(DATA_DIR);
  console.log(`  Dataset: ${experiences.length} experiences, ${related.length} related tasks`);

  const experienceTexts = experiences.map(contentForExperience);
  const relatedTexts = related.map(r => r.problem_statement);

  let experienceEmbeddings: number[][];
  if (opts.regenerateEmbeddings || !fs.existsSync(EXPERIENCE_EMBEDDINGS_CACHE)) {
    const { generateEmbeddings } = await import("../../src/infrastructure/llm/embeddings");
    experienceEmbeddings = await generateEmbeddings(experienceTexts);
    fs.mkdirSync(path.dirname(EXPERIENCE_EMBEDDINGS_CACHE), { recursive: true });
    const buf = new Float32Array(experienceEmbeddings.length * experienceEmbeddings[0]!.length);
    let i = 0;
    for (const emb of experienceEmbeddings) for (const v of emb) buf[i++] = v;
    fs.writeFileSync(EXPERIENCE_EMBEDDINGS_CACHE, Buffer.from(buf.buffer));
  } else {
    const buf = new Float32Array(fs.readFileSync(EXPERIENCE_EMBEDDINGS_CACHE).buffer);
    const dim = 384;
    experienceEmbeddings = [];
    for (let i = 0; i < buf.length; i += dim) {
      experienceEmbeddings.push(Array.from(buf.subarray(i, i + dim)));
    }
  }

  let relatedEmbeddings: number[][];
  if (opts.regenerateEmbeddings || !fs.existsSync(RELATED_EMBEDDINGS_CACHE)) {
    const { generateEmbeddings } = await import("../../src/infrastructure/llm/embeddings");
    relatedEmbeddings = await generateEmbeddings(relatedTexts);
    fs.mkdirSync(path.dirname(RELATED_EMBEDDINGS_CACHE), { recursive: true });
    fs.writeFileSync(RELATED_EMBEDDINGS_CACHE, JSON.stringify(relatedEmbeddings));
  } else {
    relatedEmbeddings = JSON.parse(fs.readFileSync(RELATED_EMBEDDINGS_CACHE, "utf-8")) as number[][];
  }

  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  runMigrations(db);

  const now = Date.now();
  const insertNode = db.prepare(
    `INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, category, supertype, domain, tags, source, metadata, sticky, ttl_days, expires_at, confidence, verification_count, usefulness_score, times_used, times_helpful, project_name)
     VALUES (?, 'project', ?, ?, NULL, 0, NULL, NULL, ?, ?, ?, 0.5, 0, NULL, 'note', 'episodic', NULL, NULL, ?, 'tool_result', NULL, 0, NULL, NULL, 0.5, 0, 0, 0, 0, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO temporal_edges (id, source_node_id, target_node_id, edge_type, scope, created_at, confidence, metadata)
     VALUES (?, ?, ?, ?, 'project', ?, 1.0, ?)`,
  );

  const nodeIds: string[] = [];
  const edges: Array<{ source: string; target: string; type: string }> = [];

  db.run("BEGIN");
  experiences.forEach((exp, idx) => {
    const expNodeId = crypto.randomUUID();
    const expLabel = `swe:${exp.instance_id}`;
    const tags = JSON.stringify([exp.repo, "swe:experience"]);
    insertNode.run(
      expNodeId,
      expLabel,
      contentForExperience(exp),
      embeddingBlob(experienceEmbeddings[idx]!),
      now,
      now,
      tags,
      SWE_CONTEXT_PROJECT_NAME,
    );
    nodeIds.push(expNodeId);

    for (const file of exp.touched_files.slice(0, 8)) {
      const fileNodeId = crypto.randomUUID();
      insertNode.run(
        fileNodeId,
        `${expLabel}:file:${file}`,
        `File ${file} in ${exp.repo} (touched while fixing ${exp.instance_id})`,
        null,
        now,
        now,
        JSON.stringify([exp.repo, "swe:file"]),
        SWE_CONTEXT_PROJECT_NAME,
      );
      nodeIds.push(fileNodeId);
      edges.push({ source: fileNodeId, target: expNodeId, type: "DURING_SESSION" });
    }
  });
  for (const edge of edges) {
    insertEdge.run(crypto.randomUUID(), edge.source, edge.target, edge.type, now, "{}");
  }
  db.run("COMMIT");
  db.close();

  const store = createSqliteMemoryStore(outDir, dbPath);
  await store.backfillBinaryEmbeddingsAndBM25("project");
  await store.rebuildHNSWIndex("project");
  await store.close();

  const relatedPath = path.join(outDir, "related-embeddings.json");
  fs.writeFileSync(
    relatedPath,
    JSON.stringify(related.map((r, i) => ({ ...r, embedding: relatedEmbeddings[i] }))),
  );

  return {
    dbPath,
    experiences: experiences.length,
    related: related.length,
    elapsedMs: Date.now() - start,
  };
}
