/** @jsxImportSource @opentui/solid */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const CONTEXT_LIMIT = 128000

function getMgmt() {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-mem.json")
  let enabled = true
  let port = 8787
  try {
    const raw = fs.readFileSync(configPath, "utf-8")
    const cfg = JSON.parse(raw) as { management?: { enabled?: boolean; port?: number } }
    if (cfg.management) {
      if (typeof cfg.management.enabled === "boolean") enabled = cfg.management.enabled
      if (typeof cfg.management.port === "number") port = cfg.management.port
    }
  } catch { /* use defaults */ }
  const url = `http://localhost:${port}`
  const pidFile = path.join(os.homedir(), ".config", "opencode", "management-server.pid")
  let running = false
  let pid: number | null = null
  try {
    if (fs.existsSync(pidFile)) {
      const txt = fs.readFileSync(pidFile, "utf-8").trim()
      pid = parseInt(txt, 10)
      if (pid > 0) {
        process.kill(pid, 0)
        running = true
      }
    }
  } catch { running = false }
  return { enabled, port, url, running, pid }
}

function getPressure(): { pressure_pct: number; total_tokens: number; timestamp: number; session_id: string } | null {
  const dbPath = path.join(os.homedir(), ".config", "opencode", "memory.db")
  try {
    if (!fs.existsSync(dbPath)) return null
    // non-HTTP: direct sqlite read via bun:sqlite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite") as { Database: new (p: string, o?: unknown) => { query: (s: string) => { get: () => unknown }; close: () => void } }
    const db = new Database(dbPath, { readonly: true })
    try {
      const row = db
        .query("SELECT pressure_pct, total_tokens, timestamp, session_id FROM context_pressure ORDER BY timestamp DESC LIMIT 1")
        .get() as { pressure_pct: number; total_tokens: number; timestamp: number; session_id: string } | null
      if (!row) return null
      return row
    } finally {
      try { db.close() } catch {}
    }
  } catch {
    return null
  }
}

function bar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width)
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(width - filled, 0))
}

export const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return

  api.keymap.registerLayer({
    commands: [
      {
        name: "mem.status",
        title: "mem status",
        category: "Plugin",
        namespace: "palette",
        slashName: "mem",
        run() {
          const m = getMgmt()
          const p = getPressure()
          const msg = `${m.enabled ? "ON" : "OFF"} ${m.url} ${m.running ? "● running" : "○ stopped"}${p ? ` | ${p.pressure_pct}% ${p.total_tokens.toLocaleString()}/${CONTEXT_LIMIT.toLocaleString()}` : ""}`
          api.ui.toast({ variant: "info", title: "Fractal Memory", message: msg, duration: 3000 })
        },
      },
    ],
  })

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(ctx) {
        const skin = ctx.theme.current
        const m = getMgmt()
        const p = getPressure()
        const dot = m.running ? "●" : "○"
        const dotColor = m.running ? (skin.success ?? "#5faf5f") : (skin.textMuted ?? "#888888")
        const statusText = m.enabled ? (m.running ? "running" : "stopped") : "disabled"
        let pressureLine = "no data yet"
        let pct = 0
        let tokens = 0
        if (p) {
          pct = p.pressure_pct
          tokens = p.total_tokens
          pressureLine = `${bar(pct)} ${pct}%  ${tokens.toLocaleString()}/${CONTEXT_LIMIT.toLocaleString()}`
        }
        const pctColor = pct >= 80 ? (skin.error ?? "#ff5f5f") : pct >= 60 ? (skin.warning ?? "#ffaf00") : (skin.textMuted ?? "#a5a5a5")
        return (
          <box
            border
            borderColor={skin.border ?? "#4a4a4a"}
            backgroundColor={skin.backgroundPanel ?? "#1d1d1d"}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            flexDirection="column"
            gap={1}
          >
            <text fg={skin.primary ?? "#5f87ff"}>
              <b>Fractal Memory</b>
            </text>
            <box flexDirection="column">
              <text fg={skin.textMuted ?? "#a5a5a5"}>mgmt {m.url}</text>
              <text fg={dotColor}>
                {dot} {statusText}
                {m.pid ? ` (pid ${m.pid})` : ""}
              </text>
            </box>
            <box flexDirection="column">
              <text fg={skin.textMuted ?? "#a5a5a5"}>pressure</text>
              <text fg={pctColor}>{pressureLine}</text>
              {p ? <text fg={skin.textMuted ?? "#a5a5a5"}>{new Date(p.timestamp).toLocaleTimeString()}</text> : null}
            </box>
          </box>
        )
      },
    },
  })
}

export default { tui }
