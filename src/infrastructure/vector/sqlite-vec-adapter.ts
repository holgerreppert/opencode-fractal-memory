import { Database } from "bun:sqlite";
import { memLog } from "../../logging";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as sqliteVec from "sqlite-vec";

let vecLoadedFor: WeakSet<Database> = new WeakSet();

/**
 * Load sqlite-vec extension into the given Database.
 * Loads once per Database instance. Uses sqliteVec.load(db) which
 * internally calls db.loadExtension with the bundled native binary.
 * Falls back gracefully if extension fails to load (e.g. missing binary).
 */
export function loadVecExtension(db: Database): boolean {
  if (vecLoadedFor.has(db)) return true;
  try {
    (sqliteVec as unknown as { load: (db: Database) => void }).load(db);
    vecLoadedFor.add(db);
    memLog("info", "sqlite-vec", "Extension loaded");
    return true;
  } catch (e) {
    memLog("warn", "sqlite-vec", "Failed to load extension, falling back to JS cosine", {
      error: String(e),
    });
    return false;
  }
}

/**
 * Convert number[] embedding to Float32Array-backed Uint8Array for sqlite-vec.
 * sqlite-vec expects a BLOB with subtype 223 (float32 vector).
 */
function embeddingToVecBlob(embedding: number[]): Uint8Array {
  const f32 = new Float32Array(embedding);
  return new Uint8Array(f32.buffer);
}

/**
 * Brute-force KNN via sqlite-vec scalar functions.
 * Scans memory_nodes.embedding_blob with vec_distance_cosine.
 * Returns candidates ordered by similarity desc (1 - distance).
 */
export function vecBruteSearch(
  db: Database,
  query: number[],
  limit: number,
  _scope?: string,
  projectName?: string | undefined,
): Array<{ id: string; score: number }> {
  if (!vecLoadedFor.has(db)) {
    // Try to load; if fails, caller should fall back
    const ok = loadVecExtension(db);
    if (!ok) return [];
  }

  const queryBlob = embeddingToVecBlob(query);

  // Build query: scan memory_nodes where embedding_blob exists
  // Use vec_distance_cosine for cosine distance; 0 = identical, 2 = opposite.
  // We ORDER BY distance ASC and convert to score = 1 - distance.
  try {
    const scopeFilter = _scope ? "AND scope = ?" : "";
    const projectFilter = projectName ? "AND project_name = ?" : "";
    const sql = `SELECT id, vec_distance_cosine(embedding_blob, ?) as distance
                 FROM memory_nodes
                 WHERE embedding_blob IS NOT NULL
                   AND (expires_at IS NULL OR expires_at > ?)
                   AND label NOT LIKE 'middle-term:%'
                   AND label NOT LIKE 'storedcontext:%'
                   ${scopeFilter}
                   ${projectFilter}
                 ORDER BY distance ASC
                 LIMIT ?`;
    const params: unknown[] = [queryBlob, Date.now()];
    if (_scope) params.push(_scope);
    if (projectName) params.push(projectName);
    params.push(limit);

    const rows = db.query(sql).all(...(params as never[])) as {
      id: string;
      distance: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      score: 1 - r.distance,
    }));
  } catch (e) {
    memLog("warn", "sqlite-vec", "vecBruteSearch failed, falling back", {
      error: String(e),
    });
    return [];
  }
}

/**
 * Insert a single embedding into memory_nodes is already done via
 * the normal INSERT. No separate vec table needed for brute-force
 * scalar mode. This is a no-op for compatibility with the HNSW API.
 */
export function vecInsert(
  _db: Database,
  _scope: string,
  _nodeId: string,
  _embedding: number[],
): void {
  // No-op: vectors live in memory_nodes.embedding_blob
}

/**
 * Delete is handled by DELETE FROM memory_nodes.
 * No separate vec table to clean.
 */
export function vecDelete(
  _db: Database,
  _nodeId: string,
): void {
  // No-op
}

/**
 * Rebuild is a no-op for scalar mode — vectors are already in memory_nodes.
 */
export function vecRebuild(_db: Database): void {
  // No-op
}
