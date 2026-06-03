import { Database } from "bun:sqlite";
import type { MemoryScope } from "./types";
import { getHNSWIndex } from "../hnsw-index";
import { extractLinks, embeddingToBlob, blobToEmbedding, withRetry } from "./utils";
import { updateBM25Index } from "./queries/search-helpers";

export async function backfillLinks(
  db: Database
): Promise<void> {
  const nodes = db.query("SELECT id, content FROM memory_nodes").all() as { id: string; content: string }[];

  for (const node of nodes) {
    const links = extractLinks(node.content);
    if (links.length === 0) continue;

    await withRetry(() => {
      db.run("DELETE FROM memory_links WHERE source_id = ?", [node.id]);
    });

    for (const label of links) {
      let targetId: string | null = null;
      try {
        const target = db.query("SELECT id FROM memory_nodes WHERE label = ?").get(label) as { id: string } | null;
        targetId = target?.id ?? null;
      } catch { /* ignore */ }

      await withRetry(() => {
        db.run(
          "INSERT OR REPLACE INTO memory_links (source_id, target_label, target_id) VALUES (?, ?, ?)",
          [node.id, label, targetId]
        );
      });
    }
  }
}

export async function backfillBinaryEmbeddingsAndBM25(
  db: Database,
  scope: MemoryScope
): Promise<void> {
  const rows = db.query("SELECT id, label, content, embedding, embedding_blob FROM memory_nodes").all() as {
    id: string;
    label: string;
    content: string;
    embedding: string | null;
    embedding_blob: Buffer | null;
  }[];

  for (const row of rows) {
    if (row.embedding && !row.embedding_blob) {
      const embedding = JSON.parse(row.embedding) as number[];
      const blob = embeddingToBlob(embedding);
      await withRetry(() => {
        db.run("UPDATE memory_nodes SET embedding_blob = ? WHERE id = ?", [blob, row.id]);
      });
    }

    updateBM25Index(db, row.id, row.content, row.label, scope);
  }
}

export async function rebuildHNSWIndex(
  getDb: (scope: MemoryScope) => Promise<Database>,
  scope?: MemoryScope | "all"
): Promise<void> {
  const hnsw = getHNSWIndex();
  const nodes: Array<{ id: string; embedding: number[]; scope: "global" | "project" }> = [];

  const scopes: MemoryScope[] = scope === "all" || !scope ? ["global", "project"] : [scope];

  for (const s of scopes) {
    const db = await getDb(s);
    const rows = db.query("SELECT id, embedding, embedding_blob FROM memory_nodes WHERE embedding IS NOT NULL OR embedding_blob IS NOT NULL").all() as Array<{
      id: string;
      embedding: string | null;
      embedding_blob: Buffer | null;
    }>;

    for (const row of rows) {
      let embedding: number[] | null = null;
      if (row.embedding_blob) {
        embedding = blobToEmbedding(row.embedding_blob);
      } else if (row.embedding) {
        embedding = JSON.parse(row.embedding);
      }

      if (embedding) {
        nodes.push({ id: row.id, embedding, scope: s });
      }
    }
  }

  await hnsw.rebuild(nodes);
}
