import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";
import { countContentSegments, generateEmbeddingWithSegments, generateMiniLMEmbedding } from "../src/infrastructure/llm/embeddings";
import { embeddingToBlob } from "../src/storage/utils";

const DB_PATH = path.join(os.homedir(), ".config", "opencode", "memory.db");
const HNSW_PATH = path.join(os.homedir(), ".config", "opencode", "hnsw-index.json");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const REVERT = process.argv.includes("--revert");

function log(msg: string) {
  console.log(`[${REVERT ? "REVERT" : DRY_RUN ? "DRY-RUN" : "REEMBED"}] ${msg}`);
}

async function main() {
  if (!DRY_RUN && !FORCE) {
    console.log("Pass --dry-run (preview only), --force (apply gte-small + chunking), or --force --revert (apply MiniLM rollback).");
    process.exit(1);
  }

  const db = Database.open(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");

  const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
  if (!tableInfo.some(c => c.name === "embedding_segments")) {
    db.run("ALTER TABLE memory_nodes ADD COLUMN embedding_segments TEXT");
  }

  const total = (db.query("SELECT COUNT(*) as c FROM memory_nodes").get() as { c: number }).c;
  const rows = db.query(
    "SELECT id, label, content, embedding, embedding_blob, embedding_segments FROM memory_nodes WHERE content IS NOT NULL AND length(content) > 0"
  ).all() as Array<{
    id: string;
    label: string;
    content: string;
    embedding: string | null;
    embedding_blob: Buffer | null;
    embedding_segments: string | null;
  }>;

  log(`Total nodes: ${total}, embeddable: ${rows.length}`);
  let changed = 0;
  let skipped = 0;

  const updates: Array<[string, number[], Buffer, string | null]> = [];
  const CONCURRENCY = 2;
  let idx = 0;
  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      const row = rows[i]!;

      if (!REVERT && DRY_RUN) {
        const currentSegments = row.embedding_segments ? (JSON.parse(row.embedding_segments) as number[][]).length : 1;
        const newSegments = await countContentSegments(row.content);
        if (currentSegments === newSegments) {
          skipped++;
        } else {
          changed++;
        }
        continue;
      }

      const result = REVERT
        ? await generateMiniLMEmbedding(row.content)
        : await generateEmbeddingWithSegments(row.content);

      const vector = REVERT ? result.embedding : result.primary;
      const blob = embeddingToBlob(vector);
      const segmentsJson = REVERT
        ? null
        : result.segments.length > 1
          ? JSON.stringify(result.segments)
          : null;

      changed++;
      if (!DRY_RUN) updates.push([row.id, vector, blob, segmentsJson]);
      if (changed % 50 === 0) log(`  progress: ${changed} embedded`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const stmt = db.prepare(
    "UPDATE memory_nodes SET embedding = ?, embedding_blob = ?, embedding_segments = ?, updated_at = ? WHERE id = ?"
  );

  if (!DRY_RUN) {
    const txn = db.transaction((updatesList) => {
      for (const [id, embedding, blob, segmentsJson] of updatesList) {
        stmt.run(JSON.stringify(embedding), blob, segmentsJson, Date.now(), id);
      }
    });
    txn(updates);
  }

  log(`Embedded: ${changed}, unchanged: ${skipped}`);
  if (!DRY_RUN) {
    log("Deleting stale hnsw-index.json (old vectors) — rebuilt on next startup");
    await unlink(HNSW_PATH).catch(() => {});
  }

  db.close();
}

main().catch(err => {
  console.error("Reembed failed:", err);
  process.exit(1);
});