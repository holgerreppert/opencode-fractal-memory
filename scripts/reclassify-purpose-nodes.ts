import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";

const DB_PATH = path.join(os.homedir(), ".config", "opencode", "memory.db");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// Purpose-centric reclassification (Tier 1): null-type nodes whose label
// prefix already declares their purpose get the matching type. Deterministic
// and reversible — label prefix is the source of truth.
const PREFIX_TYPE: Array<[prefix: string, type: string]> = [
  ["lesson:", "lesson"],
  ["decision:", "decision"],
  ["convention:", "convention"],
  ["task:", "task"],
  ["plan:", "plan"],
  ["bug:", "bug"],
  ["fix:", "fix"],
  ["skill:", "skill"],
  ["pref:", "preference"],
  ["feature:", "implementation"],
  ["arch:", "architecture"],
  ["research:", "research"],
  ["knowledge:", "knowledge"],
  ["howto:", "howto"],
  ["improvement:", "improvement"],
  ["implementation:", "implementation"],
];

function log(msg: string) {
  console.log(`[${DRY_RUN ? "DRY-RUN" : "MIGRATE"}] ${msg}`);
}

async function main() {
  if (!DRY_RUN && !FORCE) {
    console.log("Pass --dry-run (preview only) or --force (apply changes).");
    process.exit(1);
  }

  const db = Database.open(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");

  const untyped = db.query(
    "SELECT id, label FROM memory_nodes WHERE type IS NULL"
  ).all() as { id: string; label: string | null }[];

  log(`Untyped nodes: ${untyped.length}`);

  const plan: Array<{ id: string; label: string; type: string }> = [];
  const unmatched: string[] = [];
  for (const row of untyped) {
    const label = row.label ?? "";
    const hit = PREFIX_TYPE.find(([prefix]) => label.startsWith(prefix));
    if (hit) {
      plan.push({ id: row.id, label, type: hit[1] });
    } else {
      unmatched.push(label);
    }
  }

  log(`  Classifiable by label prefix: ${plan.length}`);
  log(`  Unmatched (need Tier 2 LLM pass): ${unmatched.length}`);

  const byType: Record<string, number> = {};
  for (const p of plan) byType[p.type] = (byType[p.type] ?? 0) + 1;
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    log(`    ${t}: ${c}`);
  }

  if (!DRY_RUN && plan.length > 0) {
    const stmt = db.prepare("UPDATE memory_nodes SET type = ?, category = ? WHERE id = ?");
    const txn = db.transaction(() => {
      for (const p of plan) {
        // Match existing category conventions in the store (see TYPE_CATEGORY):
        // task/plan are episodic; all other purpose types are semantic.
        const category = p.type === "task" || p.type === "plan" ? "episodic" : "semantic";
        stmt.run(p.type, category, p.id);
      }
    });
    txn();
    log(`Done — ${plan.length} nodes reclassified`);
  }

  if (unmatched.length > 0) {
    log("Unmatched labels (for Tier 2 LLM classification):");
    for (const l of unmatched.slice(0, 100)) log(`    ${l}`);
  }

  db.close();
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
