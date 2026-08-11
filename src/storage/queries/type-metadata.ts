import type { MemoryCategory, MemorySupertype, MemoryDomain } from "../types";

const TYPE_METADATA: Record<string, Record<string, unknown>> = {
  note:                { tags: ["auto-generated"], customType: "note" },
  summary:             { tags: ["compressed"] },
  lesson:              { tags: ["lesson-auto"] },
  plan:                { tags: ["auto-generated"], customType: "plan" },
  playbook:            { tags: ["playbook"] },
  event:               { tags: ["event"] },
  task:                { tags: ["task"] },
  research:            { tags: ["research"] },
  project:             { tags: ["project"] },
  implementation:      { tags: ["implementation"] },
  bug:                 { tags: ["bug"] },
  pref:                { tags: ["preference"] },
  howto:               { tags: ["howto"] },
  core:                { tags: ["core", "compressed"] },
  technical:           { tags: ["technical"] },
  session:             { tags: ["session"] },
  legal:               { tags: ["legal"] },
  knowledge:           { tags: ["knowledge"] },
  improvement:         { tags: ["improvement"] },
  decision:            { tags: ["decision"] },
  "best-practices":    { tags: ["best-practices"] },
  audit:               { tags: ["audit"] },
  architecture:        { tags: ["architecture"] },
  analysis:            { tags: ["analysis"] },
  "rule:mandatory":    { tags: ["rule", "mandatory"] },
  review:              { tags: ["review"] },
  "project-history":   { tags: ["project-history"] },
  preference:          { tags: ["preference"] },
  idea:                { tags: ["idea"] },
  fix:                 { tags: ["fix"] },
  fact:                { tags: ["fact"] },
  exploration:         { tags: ["exploration"] },
  "debug-investigation": { tags: ["debug"] },
  convention:          { tags: ["convention"] },
  config:              { tags: ["config"] },
  concept:             { tags: ["concept"] },
  skill:               { tags: ["skill"] },
};

const TYPE_CATEGORY: Record<string, MemoryCategory> = {
  event: "episodic",
  note: "episodic",
  session: "episodic",
  task: "episodic",
  plan: "episodic",
  exploration: "episodic",
  "debug-investigation": "episodic",
  improvement: "episodic",
  review: "episodic",
  lesson: "semantic",
  knowledge: "semantic",
};

const TYPE_SUPERTYPE: Record<string, MemorySupertype> = {
  concept: "declarative",
  fact: "declarative",
  knowledge: "declarative",
  architecture: "declarative",
  convention: "declarative",
  research: "declarative",
  lesson: "procedural",
  howto: "procedural",
  skill: "procedural",
  playbook: "procedural",
  event: "experiential",
  note: "experiential",
  session: "experiential",
  task: "experiential",
  plan: "experiential",
  exploration: "experiential",
  "debug-investigation": "experiential",
  improvement: "experiential",
  review: "experiential",
  bug: "experiential",
  summary: "meta",
  core: "meta",
  fix: "meta",
};

const TYPE_DOMAIN: Record<string, MemoryDomain> = {
  architecture: "architecture",
  knowledge: "architecture",
  howto: "operations",
  config: "operations",
  technical: "operations",
  concept: "knowledge",
  fact: "knowledge",
  research: "knowledge",
  "rule:mandatory": "rules",
  "rule:standard": "rules",
  "rule:suggestion": "rules",
  convention: "rules",
  "best-practices": "rules",
  event: "history",
  note: "history",
  session: "history",
  task: "history",
  plan: "history",
  exploration: "history",
  "debug-investigation": "history",
  improvement: "history",
  review: "history",
  bug: "history",
  fix: "history",
  summary: "history",
  "project-history": "history",
  skill: "patterns",
  playbook: "patterns",
  lesson: "patterns",
  preference: "preferences",
  pref: "preferences",
};

export function resolveNodeCategory(type: string | null | undefined): MemoryCategory | null {
  if (!type) return null;
  return TYPE_CATEGORY[type] ?? "semantic";
}

export function resolveNodeSupertype(type: string | null | undefined): MemorySupertype | null {
  if (!type) return null;
  return TYPE_SUPERTYPE[type] ?? null;
}

export function resolveNodeDomain(type: string | null | undefined): MemoryDomain {
  if (!type) return null;
  return TYPE_DOMAIN[type] ?? null;
}

export function autoGenerateMetadata(type: string | null | undefined): Record<string, unknown> | null {
  if (!type) return { tags: ["untyped"] };
  return TYPE_METADATA[type] ?? { tags: [type] };
}

export function validateLabel(label: string): string {
  const trimmed = label.trim();
  if (!/^[a-z0-9][a-z0-9-_:.]{1,60}$/i.test(trimmed)) {
    throw new Error(
      `Invalid label "${label}". Use letters/numbers/dash/underscore/colon (2-61 chars).`,
    );
  }
  return trimmed;
}
