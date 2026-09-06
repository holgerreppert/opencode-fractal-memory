import { Database } from "bun:sqlite";
import type { MemoryScope } from "./types";
import { getHNSWIndex } from "../infrastructure/vector/hnsw-index";
import { extractLinks, embeddingToBlob, blobToEmbedding, withRetry } from "./utils";
import { updateBM25Index } from "./queries/search-helpers";
import { memLog } from "../logging";

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
  // Quick check: skip if BM25 already populated and no blob conversion needed
  const bm25Count = db.query("SELECT COUNT(*) as c FROM bm25_doc_stats WHERE scope = ?").get(scope) as { c: number } | undefined;
  const needsBlob = db.query("SELECT COUNT(*) as c FROM memory_nodes WHERE embedding IS NOT NULL AND embedding_blob IS NULL").get() as { c: number } | undefined;

  if ((bm25Count?.c ?? 0) > 0 && (needsBlob?.c ?? 0) === 0) {
    return; // Already up to date — BM25 is maintained by create/update/delete paths
  }

  const rows = db.query("SELECT id, label, content, summary, keywords, embedding, embedding_blob FROM memory_nodes").all() as {
    id: string;
    label: string;
    content: string;
    summary: string | null;
    keywords: string | null;
    embedding: string | null;
    embedding_blob: Buffer | null;
  }[];

  db.run("BEGIN TRANSACTION");
  try {
    for (const row of rows) {
      if (row.embedding && !row.embedding_blob) {
        const embedding = JSON.parse(row.embedding) as number[];
        const blob = embeddingToBlob(embedding);
        db.run("UPDATE memory_nodes SET embedding_blob = ? WHERE id = ?", [blob, row.id]);
      }

      updateBM25Index(db, row.id, row.content, row.label, scope, row.summary, row.keywords);
    }
    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

export async function backfillSupertype(db: Database): Promise<void> {
  const SUPERTYPE_MAP: Record<string, string> = {
    concept: "declarative", fact: "declarative", knowledge: "declarative",
    architecture: "declarative", convention: "declarative", research: "declarative",
    lesson: "procedural", howto: "procedural", skill: "procedural", playbook: "procedural",
    event: "experiential", note: "experiential", session: "experiential",
    task: "experiential", plan: "experiential", exploration: "experiential",
    "debug-investigation": "experiential", improvement: "experiential",
    review: "experiential", bug: "experiential",
    summary: "meta", core: "meta", fix: "meta",
  };

  const rows = db.query("SELECT id, type FROM memory_nodes WHERE supertype IS NULL AND type IS NOT NULL").all() as { id: string; type: string }[];
  for (const row of rows) {
    const supertype = SUPERTYPE_MAP[row.type] ?? null;
    if (supertype) {
      db.run("UPDATE memory_nodes SET supertype = ? WHERE id = ?", [supertype, row.id]);
    }
  }
}

export async function rebuildHNSWIndex(
  getDb: (scope: MemoryScope) => Promise<Database>,
  scope?: MemoryScope | "all"
): Promise<void> {
  const hnsw = getHNSWIndex();
  let totalWithEmbeddings = 0;

  const scopes: MemoryScope[] = scope === "all" || !scope ? ["global", "project"] : [scope];

  for (const s of scopes) {
    const db = await getDb(s);
    const count = db.query("SELECT COUNT(*) as c FROM memory_nodes WHERE (embedding IS NOT NULL OR embedding_blob IS NOT NULL) AND scope = ?").get(s) as { c: number } | undefined;
    totalWithEmbeddings += count?.c ?? 0;
  }

  // Skip if HNSW already has the same number of nodes
  const stats = hnsw.getStats();
  const totalInIndex = stats.globalNodes + stats.projectNodes;
  if (totalWithEmbeddings > 0 && totalInIndex === totalWithEmbeddings) {
    return;
  }

  const nodes: Array<{ id: string; embedding: number[]; scope: "global" | "project"; segments?: number[][] }> = [];

  for (const s of scopes) {
    const db = await getDb(s);
    const rows = db.query("SELECT id, embedding, embedding_blob, embedding_segments FROM memory_nodes WHERE (embedding IS NOT NULL OR embedding_blob IS NOT NULL) AND scope = ?").all(s) as Array<{
      id: string;
      embedding: string | null;
      embedding_blob: Buffer | null;
      embedding_segments: string | null;
    }>;

    for (const row of rows) {
      let embedding: number[] | null = null;
      if (row.embedding_blob) {
        embedding = blobToEmbedding(row.embedding_blob);
      } else if (row.embedding) {
        embedding = JSON.parse(row.embedding);
      }

      if (embedding) {
        let segments: number[][] | undefined;
        if (row.embedding_segments) {
          try {
            const parsed = JSON.parse(row.embedding_segments) as unknown;
            if (Array.isArray(parsed)) segments = parsed as number[][];
          } catch { /* ignore corrupt segments */ }
        }
        nodes.push(segments
          ? { id: row.id, embedding, scope: s, segments }
          : { id: row.id, embedding, scope: s });
      }
    }
  }

  await hnsw.rebuild(nodes);
  const rebuildStats = hnsw.getStats();
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
  memLog("info", "hnsw", "HNSW index rebuilt", { nodes: nodes.length, globalNodes: rebuildStats.globalNodes, projectNodes: rebuildStats.projectNodes, rssMB: rss });
}
