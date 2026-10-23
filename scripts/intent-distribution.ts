#!/usr/bin/env bun
/**
 * P1 sanity look: classify the collected `intent_lines` corpus with the
 * heuristic 8-intent classifier and print the distribution.
 *
 *   bun run scripts/intent-distribution.ts
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { INTENT_ORDER, classifyIntent, intentDistribution } from "../src/application/ranking/intent-dist";

const dbPath = join(homedir(), ".config", "opencode", "memory.db");
const db = new Database(dbPath, { readonly: true });

const rows = db.query(
  "SELECT raw_text, timestamp FROM intent_lines ORDER BY timestamp ASC",
).all() as Array<{ raw_text: string; timestamp: number }>;

const texts = rows.map(r => r.raw_text);
const dist = intentDistribution(texts);

const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const span = rows.length > 0
  ? ` (${fmtDate(rows[0]!.timestamp)} → ${fmtDate(rows[rows.length - 1]!.timestamp)})`
  : "";
console.log(`intent_lines corpus: ${dist.total} rows${span}`);
console.log(`low-confidence (<0.5): ${dist.lowConfidence}`);
console.log("");
for (const intent of INTENT_ORDER) {
  const pct = (dist.distribution[intent] * 100).toFixed(1);
  console.log(`${intent.padEnd(10)} ${String(dist.counts[intent]).padStart(4)}  ${pct.padStart(5)}%`);
}

console.log("\nOne example per intent:");
for (const intent of INTENT_ORDER) {
  const sample = texts.find(t => classifyIntent(t).intent === intent);
  if (sample) console.log(`  ${intent.padEnd(10)} ${sample.slice(0, 80)}`);
}

db.close();
