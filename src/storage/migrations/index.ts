import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./definitions";

export { MIGRATIONS } from "./definitions";
export type { Migration } from "./definitions";

export const CURRENT_VERSION = 20;

export function getCurrentVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version: number } | null;
  return row?.user_version ?? 0;
}

export function runMigrations(db: Database): number {
  for (const migration of MIGRATIONS) {
    migration.up(db);
  }
  db.run(`PRAGMA user_version = ${CURRENT_VERSION}`);
  return CURRENT_VERSION;
}

export function getConfig(db: Database, key: string, defaultValue: string): string {
  const row = db.query("SELECT value FROM memory_config WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? defaultValue;
}

export function setConfig(db: Database, key: string, value: string): void {
  db.run(
    "INSERT OR REPLACE INTO memory_config (key, value, updated_at) VALUES (?, ?, ?)",
    [key, value, Date.now()],
  );
}
