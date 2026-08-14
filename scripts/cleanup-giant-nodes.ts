import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";

const DB_PATH = path.join(os.homedir(), ".config", "opencode", "memory.db");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const MIN_BYTES = 1024 * 1024; // 1 MB

function log(msg: string) {
  console.log(`[${DRY_RUN ? "DRY-RUN" : "CLEANUP"}] ${msg}`);
}

async function main() {
  if (!DRY_RUN && !FORCE) {
    console.log("Pass --dry-run (preview only) or --force (apply changes).");
    process.exit(1);
  }

  const db = Database.open(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");

  const giants = db.query(
    "SELECT id, scope, label, type, length(content) AS len FROM memory_nodes WHERE length(content) > ? ORDER BY len DESC"
  ).all(MIN_BYTES) as { id: string; scope: string; label: string | null; type: string | null; len: number }[];

  const totalMb = giants.reduce((s, g) => s + g.len, 0) / (1024 * 1024);
  log(`Nodes with content > 1MB: ${giants.length} (${totalMb.toFixed(1)} MB total)`);

  for (const g of giants) {
    log(`  ${(g.len / 1048576).toFixed(1)}MB  ${g.scope.padEnd(8)} ${(g.label ?? g.id.slice(0, 24)).slice(0, 60)}  [${g.type ?? "?"}]`);
  }

  if (!DRY_RUN && giants.length > 0) {
    const stmt = db.prepare("DELETE FROM memory_nodes WHERE id = ?");
    const txn = db.transaction(() => {
      for (const g of giants) stmt.run(g.id);
    });
    txn();
    log(`Done — deleted ${giants.length} nodes (${totalMb.toFixed(1)} MB freed)`);
  }

  db.close();
}

main().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});