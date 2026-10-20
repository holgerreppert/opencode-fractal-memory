/**
 * Dream-RSI Node Sweep
 *
 * At session.idle, reviews all nodes with usage data and adjusts their
 * importance based on usefulness/helpfulness ratios. High-performing
 * nodes get promoted, consistently unhelpful ones get demoted, and
 * stale unused nodes get deleted. This closes the recursive
 * self-improvement loop: better nodes → better retrieval → better sessions.
 *
 * Scoped to project nodes only (not global rules/lessons).
 * Protected types (rule, lesson, dot, workflow, dream-rsi) are never swept.
 * Capped at 20 deletions per sweep to prevent mass data loss.
 *
 * Reference: Dream-RSI (arXiv 2609.14858) — policy improvement via replay
 */

import type { MemoryStore } from "../../storage/sqlite";

export interface SweepResult {
  promoted: number;
  demoted: number;
  superseded: number;
}

const MAX_SUPERSEDED = 20;

function isProtected(node: {
  sticky: boolean;
  type: string | null;
  label: string | null;
}): boolean {
  return node.sticky
    || node.type === "rule"
    || node.type === "lesson"
    || node.type === "dot"
    || node.type === "workflow"
    || (node.label ?? "").startsWith("rule:")
    || (node.label ?? "").startsWith("lesson:")
    || (node.label ?? "").startsWith("dot:")
    || (node.label ?? "").startsWith("dream-rsi:");
}

/**
 * Run the feedback sweep: promote nodes that are consistently helpful,
 * demote ones that are consistently unhelpful, and delete stale unused ones.
 */
export async function sweepNodeRatings(store: MemoryStore): Promise<SweepResult> {
  let promoted = 0;
  let demoted = 0;
  let superseded = 0;

  const nodes = await store.listNodes("project", undefined, 500);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const node of nodes) {
    if (isProtected(node)) continue;

    if (node.timesUsed > 0) {
      const ratio = node.timesHelpful / node.timesUsed;

      if (ratio > 0.8 && node.timesUsed > 10) {
        const newImportance = Math.min(node.importance + 0.1, 1.0);
        if (newImportance !== node.importance) {
          await store.updateNode(node.id, { importance: newImportance });
          promoted++;
        }
      } else if (ratio < 0.15 && node.timesUsed > 20) {
        const newImportance = Math.max(node.importance - 0.05, 0.1);
        if (newImportance !== node.importance) {
          await store.updateNode(node.id, { importance: newImportance });
          demoted++;
        }
      }
    }

    if (superseded >= MAX_SUPERSEDED) break;

    if (node.accessCount === 0 && node.createdAt.getTime() < thirtyDaysAgo) {
      try {
        await store.deleteNode(node.id);
        superseded++;
      } catch {
        // best-effort: node may have been deleted already
      }
    }
  }

  return { promoted, demoted, superseded };
}
