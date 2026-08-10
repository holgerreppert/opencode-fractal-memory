import type { SearchIntent } from "../../storage/types";

/**
 * Intent-based category/type boost. Purpose-centric types dominate their
 * intent: debugging is served by distilled lessons/bug records, reading by
 * architectural knowledge, editing by conventions/decisions. These outrank
 * the generic supertype fallback. Multiplies the fused score in the pipeline.
 */
export function computeIntentWeight(
  intent: SearchIntent | undefined,
  category: string | null,
  type: string | null,
  supertype: string | null,
): number {
  const purposeBoost: Record<string, number> = {
    read: type === "knowledge" || type === "concept" || type === "architecture" ? 1.4 : 1.0,
    edit: type === "convention" || type === "decision" || type === "preference" ? 1.4 : 1.0,
    debug: type === "lesson" || type === "bug" || type === "fix" || type === "debug-investigation" ? 1.4 : 1.0,
  };
  if (intent) {
    const boost = purposeBoost[intent];
    if (boost !== undefined && boost !== 1.0) return boost;
  }

  if (supertype) {
    switch (intent) {
      case "read":
      case "edit":
        if (supertype === "procedural" || supertype === "declarative") return 1.3;
        if (supertype === "experiential") return 0.6;
        return 1.0;
      case "debug":
        if (supertype === "experiential") return 1.3;
        if (supertype === "declarative" || supertype === "procedural") return 0.8;
        return 1.0;
      case "discovery":
        return 1.0;
      default:
        if (supertype === "experiential") return 0.5;
        return 1.0;
    }
  }
  switch (intent) {
    case "read":
    case "edit":
      return category === "episodic" ? 0.6 : 1.2;
    case "debug":
      return category === "episodic" ? 1.2 : 0.8;
    case "discovery":
      return 1.0;
    default:
      return category === "episodic" ? 0.5 : 1.0;
  }
}
