/**
 * Dream-RSI Exploration Rules
 *
 * Encodes the 4 exploration rules from Dream-RSI's exploration prompt
 * (Appendix B, Listing 1) into our lesson extraction system. These rules
 * shape how lessons are extracted and categorized, improving the quality
 * of the "discovery history" that feeds the replay simulator.
 *
 * Rules:
 * 1. Read everything — include full context in lesson nodes
 * 2. Distinguish bad idea vs implementation bug — tag rootCause
 * 3. Avoid local optima — detect clustering and diversify
 * 4. Genuinely new — dedup via failure signature
 *
 * Reference: Dream-RSI (arXiv 2609.14858) — Appendix B, Listing 1
 */

export interface ExplorationClassification {
  rootCause: "bad-idea" | "implementation-bug" | "unknown";
  isClustered: boolean;
  isDuplicate: boolean;
}

/**
 * Rule 2: Distinguish "bad core idea" from "implementation bug".
 * If the same tool fails multiple times → likely a bad idea.
 * If different tools fail → likely an implementation bug.
 */
export function classifyRootCause(
  failedTools: Map<string, number>,
  totalFailed: number,
): "bad-idea" | "implementation-bug" | "unknown" {
  if (totalFailed === 0) return "unknown";

  const uniqueTools = failedTools.size;
  const maxFailuresPerTool = Math.max(...failedTools.values());

  if (uniqueTools === 1 && maxFailuresPerTool >= 2) {
    return "bad-idea";
  }

  if (uniqueTools >= 2 && maxFailuresPerTool <= 2) {
    return "implementation-bug";
  }

  return "unknown";
}

/**
 * Rule 3: Detect clustering — if many recent lessons have the same
 * failure signature or same failed tool, the system is stuck in a
 * local optimum. Signal this to the lesson extraction so it can
 * flag the need for structural diversification.
 */
export function detectClustering(
  recentSignatures: string[],
  threshold = 3,
): boolean {
  if (recentSignatures.length < threshold) return false;

  const counts = new Map<string, number>();
  for (const sig of recentSignatures) {
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }

  const maxCount = Math.max(...counts.values());
  return maxCount >= threshold;
}

/**
 * Rule 4: Already handled by existing sig: tag dedup in lesson-extraction.ts
 * (lines 45-55). This function provides the classification for metadata.
 */
export function isDuplicateSignature(
  existingSignatures: string[],
  newSignature: string,
): boolean {
  return existingSignatures.includes(newSignature);
}

/**
 * Apply all 4 exploration rules to classify a lesson extraction result.
 */
export function classifyExtraction(
  failedTools: Map<string, number>,
  totalFailed: number,
  recentSignatures: string[],
  newSignature: string,
): ExplorationClassification {
  return {
    rootCause: classifyRootCause(failedTools, totalFailed),
    isClustered: detectClustering(recentSignatures),
    isDuplicate: isDuplicateSignature(recentSignatures, newSignature),
  };
}
