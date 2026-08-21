import * as fs from "node:fs"
import * as os from "node:os"
import { Database } from "bun:sqlite"
import { scopeDbPath } from "../infrastructure/db/DbProvider"
import { memLog } from "../logging"

export type SyncPressure = {
  pressure_pct: number
  total_tokens: number
  timestamp: number
  session_id: string
} | null

export function getLatestPressureSync(): SyncPressure {
  const dbPath = scopeDbPath(os.homedir(), "global")
  try {
    if (!fs.existsSync(dbPath)) return null
    const db = new Database(dbPath, { readonly: true } as unknown as Record<string, unknown>)
    try {
      const row = db
        .query("SELECT pressure_pct, total_tokens, timestamp, session_id FROM context_pressure ORDER BY timestamp DESC LIMIT 1")
        .get() as SyncPressure
      if (!row) return null
      return row
    } finally {
      try {
        db.close()
      } catch { /* ignore close error */ }
    }
  } catch (e) {
    memLog("warn", "storage", "getLatestPressureSync failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}
