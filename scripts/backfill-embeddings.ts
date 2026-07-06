import { Database } from "bun:sqlite";
import * as path from "node:path";
import * as os from "node:os";
import { generateEmbedding } from "../src/infrastructure/llm/embeddings";
import { embeddingToBlob } from "../src/storage/utils";

const DB_PATH = path.join(os.homedir(), ".config/opencode/memory.db");

async function main() {
  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");

  const rows = db.query(
    "SELECT id, scope, content, label FROM memory_nodes WHERE embedding IS NULL AND embedding_blob IS NULL AND length(content) > 0"
  ).all() as { id: string; scope: string; content: string; label: string | null }[];

  console.log(`Found ${rows.length} nodes missing embeddings`);

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    const text = (row.label ?? "") + " " + row.content;
    const trimmed = text.slice(0, 8000);
    try {
      const embedding = await generateEmbedding(trimmed);
      const blob = embeddingToBlob(embedding);
      const scope = row.scope;
      db.run(
        "UPDATE memory_nodes SET embedding = ?, embedding_blob = ? WHERE id = ?",
        [JSON.stringify(embedding), blob, row.id]
      );
      done++;
      if (done % 50 === 0) console.log(`Progress: ${done}/${rows.length}`);
    } catch (err) {
      failed++;
      console.error(`Failed ${row.id.slice(0, 8)}:`, String(err));
    }
  }

  console.log(`Done: ${done} embedded, ${failed} failed`);
  db.close();
}

main().catch(console.error);
