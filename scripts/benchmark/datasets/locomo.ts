import * as fs from "node:fs";

export type Turn = {
  speaker: string;
  dia_id: string;
  text: string;
};

export type QAPair = {
  question: string;
  answer: string;
  evidence: string[];
  category: number;
};

export type Conversation = {
  sample_id: string;
  conversation: Record<string, Turn[]>;
  qa: QAPair[];
  event_summary: Record<string, unknown>;
  observation: Record<string, unknown>;
  session_summary: Record<string, unknown>;
};

export const CATEGORY_LABELS: Record<number, string> = {
  1: "single_hop",
  2: "multi_hop",
  3: "temporal",
  4: "commonsense",
  5: "adversarial",
};

export function loadDataset(path: string): Conversation[] {
  const raw = fs.readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  // JSON array uses numeric keys
  return Array.isArray(parsed) ? parsed : Object.values(parsed) as Conversation[];
}

export function getCategoryLabel(cat: number): string {
  return CATEGORY_LABELS[cat] ?? "unknown";
}
