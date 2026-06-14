import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";

const DB_PATH = path.join(os.homedir(), ".config", "opencode", "memory.db");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const TYPE_METADATA: Record<string, Record<string, unknown>> = {
  note:                   { tags: ["auto-generated"], customType: "note" },
  summary:                { tags: ["compressed"] },
  lesson:                 { tags: ["lesson-auto"] },
  plan:                   { tags: ["auto-generated"], customType: "plan" },
  playbook:               { tags: ["playbook"] },
  event:                  { tags: ["event"] },
  task:                   { tags: ["task"] },
  research:               { tags: ["research"] },
  project:                { tags: ["project"] },
  implementation:         { tags: ["implementation"] },
  bug:                    { tags: ["bug"] },
  pref:                   { tags: ["preference"] },
  howto:                  { tags: ["howto"] },
  core:                   { tags: ["core", "compressed"] },
  technical:              { tags: ["technical"] },
  session:                { tags: ["session"] },
  legal:                  { tags: ["legal"] },
  knowledge:              { tags: ["knowledge"] },
  improvement:            { tags: ["improvement"] },
  decision:               { tags: ["decision"] },
  "best-practices":       { tags: ["best-practices"] },
  audit:                  { tags: ["audit"] },
  architecture:           { tags: ["architecture"] },
  analysis:               { tags: ["analysis"] },
  "rule:mandatory":       { tags: ["rule", "mandatory"] },
  review:                 { tags: ["review"] },
  "project-history":      { tags: ["project-history"] },
  preference:             { tags: ["preference"] },
  idea:                   { tags: ["idea"] },
  fix:                    { tags: ["fix"] },
  fact:                   { tags: ["fact"] },
  exploration:            { tags: ["exploration"] },
  "debug-investigation":  { tags: ["debug"] },
  convention:             { tags: ["convention"] },
  config:                 { tags: ["config"] },
  concept:                { tags: ["concept"] },
  skill:                  { tags: ["skill"] },
};

function metadataForType(type: string | null): Record<string, unknown> {
  if (!type) return { tags: ["untyped"] };
  return TYPE_METADATA[type] ?? { tags: [type] };
}

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

  // Phase 1: Backfill metadata
  if (true) {
    const total = (db.query("SELECT COUNT(*) as c FROM memory_nodes").get() as { c: number }).c;
    const nullMeta = db.query("SELECT id, type FROM memory_nodes WHERE metadata IS NULL").all() as { id: string; type: string | null }[];

    log(`Total nodes: ${total}, ${nullMeta.length} with null metadata`);

    if (nullMeta.length > 0) {
      log(`  Type breakdown:`);
      const counts: Record<string, number> = {};
      for (const row of nullMeta) {
        const t = row.type ?? "(null)";
        counts[t] = (counts[t] ?? 0) + 1;
      }
      for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        log(`    ${t}: ${c}`);
      }

      if (!DRY_RUN) {
        const stmt = db.prepare("UPDATE memory_nodes SET metadata = ? WHERE id = ?");
        const txn = db.transaction(() => {
          for (const row of nullMeta) {
            const meta = metadataForType(row.type);
            stmt.run(JSON.stringify(meta), row.id);
          }
        });
        txn();
        log(`  Done — ${nullMeta.length} nodes updated`);
      }
    }
  }

  // Phase 2: Usefulness floor (0.1) for nodes accessed at least once
  if (true) {
    const count = (db.query("SELECT COUNT(*) as c FROM memory_nodes WHERE usefulness_score = 0 AND times_used > 0").get() as { c: number }).c;
    log(`Nodes with 0 usefulness but times_used > 0: ${count}`);

    if (count > 0 && !DRY_RUN) {
      db.run("UPDATE memory_nodes SET usefulness_score = 0.1 WHERE usefulness_score = 0 AND times_used > 0");
      log(`  Set usefulness_score = 0.1`);
    }
  }

  // Phase 3: Usefulness baseline (0.3) for file-label nodes
  if (true) {
    const count = (db.query("SELECT COUNT(*) as c FROM memory_nodes WHERE usefulness_score = 0 AND label LIKE 'file:%'").get() as { c: number }).c;
    log(`File-label nodes with 0 usefulness: ${count}`);

    if (count > 0 && !DRY_RUN) {
      db.run("UPDATE memory_nodes SET usefulness_score = 0.3 WHERE usefulness_score = 0 AND label LIKE 'file:%'");
      log(`  Set usefulness_score = 0.3`);
    }
  }

  // Phase 4: Clean up old middle-term captures
  if (true) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oldCount = (db.query(
      "SELECT COUNT(*) as c FROM memory_nodes WHERE metadata LIKE '%middle-term%' AND created_at < ?"
    ).get(cutoff) as { c: number }).c;
    log(`Middle-term captures older than 30 days: ${oldCount}`);

    if (oldCount > 0 && !DRY_RUN) {
      db.run(
        "UPDATE memory_nodes SET sticky = 0 WHERE metadata LIKE '%middle-term%' AND created_at < ?",
        [cutoff]
      );
      db.run(
        "DELETE FROM memory_nodes WHERE sticky = 0 AND metadata LIKE '%middle-term%' AND created_at < ?",
        [cutoff]
      );
      log(`  Cleaned up ${oldCount} stale captures`);
    }
  }

  // Summary
  const finalNullMeta = (db.query("SELECT COUNT(*) as c FROM memory_nodes WHERE metadata IS NULL").get() as { c: number }).c;
  const finalZeroUseful = (db.query("SELECT COUNT(*) as c FROM memory_nodes WHERE usefulness_score = 0").get() as { c: number }).c;
  log(`--- Summary ---`);
  log(`Null metadata:    907 → ${finalNullMeta}`);
  log(`Zero usefulness:  917 → ${finalZeroUseful}`);

  db.close();
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
