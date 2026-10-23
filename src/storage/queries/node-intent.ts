import type { Database } from "bun:sqlite";
import { withRetry } from "../utils";

/**
 * Per-node intent-usefulness vector (P2 of the intent usefulness-vector
 * plan), stored inside `memory_nodes.metadata` under the `intentVector`
 * key. The vector counts how often a node was injected in a round whose
 * agent-declared intent landed on each of the 8 task intents.
 *
 * Metadata is read-parse-mutate-written so sibling keys (`totalCalls`,
 * `editCount`, …) are preserved. Worst case under a rare concurrent
 * idle race is a lost +1, never corruption.
 */
export interface IntentVector {
  [intent: string]: number;
}

/** Parse an `intentVector` out of node metadata (object or raw JSON text). */
export function parseIntentVector(metadata: unknown): IntentVector {
  let value: unknown = metadata;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = (value as { intentVector?: unknown }).intentVector;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const vector: IntentVector = {};
  for (const [intent, count] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      vector[intent] = count;
    }
  }
  return vector;
}

/** Increment `metadata.intentVector[intent]` for each existing node. */
export async function bumpNodeIntentVector(
  db: Database,
  nodeIds: string[],
  intent: string,
): Promise<number> {
  let bumped = 0;
  for (const nodeId of nodeIds) {
    try {
      const row = db.query(
        "SELECT metadata FROM memory_nodes WHERE id = ?"
      ).get(nodeId) as { metadata: string | null } | null;
      if (!row) continue;

      let metadata: Record<string, unknown> = {};
      if (row.metadata) {
        try {
          const parsed = JSON.parse(row.metadata) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>;
          }
        } catch {
          // Malformed metadata — start clean rather than losing the bump.
        }
      }

      const vector = parseIntentVector(metadata);
      vector[intent] = (vector[intent] ?? 0) + 1;
      const next = JSON.stringify({ ...metadata, intentVector: vector });
      await withRetry(() => {
        db.run("UPDATE memory_nodes SET metadata = ? WHERE id = ?", [next, nodeId]);
      });
      bumped++;
    } catch {
      // Per-node best-effort — skip and continue.
    }
  }
  return bumped;
}
