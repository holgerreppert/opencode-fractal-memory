/** @jsxImportSource @opentui/solid */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { Context as V2TuiContext } from "@opencode/plugin/tui/context"
import { getLatestPressureSync } from "./storage/sync-pressure"

declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
  }
}

const CONTEXT_LIMIT = 128000

function getMgmt() {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-mem.json")
  let enabled = true
  let port = 8788
  try {
    const raw = fs.readFileSync(configPath, "utf-8")
    const cfg = JSON.parse(raw) as { management?: { enabled?: boolean; port?: number; sveltePort?: number } }
    if (cfg.management) {
      if (typeof cfg.management.enabled === "boolean") enabled = cfg.management.enabled
      // Mirror composition-root: sveltePort wins over legacy port key.
      if (typeof cfg.management.sveltePort === "number") port = cfg.management.sveltePort
      else if (typeof cfg.management.port === "number") port = cfg.management.port
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
  return getLatestPressureSync()
}

function bar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width)
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(width - filled, 0))
}

/** Text of the `/mem` status command — shared by the V1 and V2 keymaps. */
function statusMessage(): string {
  const m = getMgmt()
  const p = getPressure()
  return `${m.enabled ? "ON" : "OFF"} ${m.url} ${m.running ? "● running" : "○ stopped"}${p ? ` | ${p.pressure_pct}% ${p.total_tokens.toLocaleString()}/${CONTEXT_LIMIT.toLocaleString()}` : ""}`
}

/**
 * Colors for the sidebar box.
 *
 * V1 exposes a flat theme (`theme.current` with hex strings); V2 exposes
 * nested semantic tokens whose values are RGBA objects. Both are passed
 * through to the OpenTUI color props, which accept either.
 */
interface SidebarColors {
  primary: unknown
  textMuted: unknown
  border: unknown
  backgroundPanel: unknown
  success: unknown
  error: unknown
  warning: unknown
}

/**
 * The sidebar box. `getColors` is called during render so the theme is read
 * inside the reactive scope (V1: `theme.current`; V2: `ctx.theme`).
 */
function renderSidebar(getColors: () => SidebarColors) {
  const skin = getColors()
  const m = getMgmt()
  const p = getPressure()
  const dot = m.running ? "●" : "○"
  const dotColor = m.running ? skin.success : skin.textMuted
  const statusText = m.enabled ? (m.running ? "running" : "stopped") : "disabled"
  let pressureLine = "no data yet"
  let pct = 0
  let tokens = 0
  if (p) {
    pct = p.pressure_pct
    tokens = p.total_tokens
    pressureLine = `${bar(pct)} ${pct}% ${tokens.toLocaleString()}/${CONTEXT_LIMIT.toLocaleString()}`
  }
  const pctColor = pct >= 80 ? skin.error : pct >= 60 ? skin.warning : skin.textMuted
  return (
    <box
      border
      borderColor={skin.border}
      backgroundColor={skin.backgroundPanel}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
      gap={1}
    >
      <text fg={skin.primary}>
        <b>Fractal Memory</b>
      </text>
      <box flexDirection="column">
        <text fg={skin.textMuted}>mgmt {m.url}</text>
        <text fg={dotColor}>
          {dot} {statusText}
          {m.pid ? ` (pid ${m.pid})` : ""}
        </text>
      </box>
      <box flexDirection="column">
        <text fg={skin.textMuted}>pressure</text>
        <text fg={pctColor}>{pressureLine}</text>
        {p ? <text fg={skin.textMuted}>{new Date(p.timestamp).toLocaleTimeString()}</text> : null}
      </box>
    </box>
  )
}

/**
 * V1 entrypoint (OpenCode 1.18.x terminal client).
 *
 * Registers the `/mem` palette command and the Fractal Memory sidebar box.
 */
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
          api.ui.toast({ variant: "info", title: "Fractal Memory", message: statusMessage(), duration: 3000 })
        },
      },
    ],
  })

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(ctx: any) {
        return renderSidebar(() => {
          const skin = ctx.theme.current
          return {
            primary: skin.primary ?? "#5f87ff",
            textMuted: skin.textMuted ?? "#a5a5a5",
            border: skin.border ?? "#4a4a4a",
            backgroundPanel: skin.backgroundPanel ?? "#1d1d1d",
            success: skin.success ?? "#5faf5f",
            error: skin.error ?? "#ff5f5f",
            warning: skin.warning ?? "#ffaf00",
          }
        })
      },
    },
  })
}

/**
 * V2 entrypoint (OpenCode 2.x terminal client).
 *
 * V2 registers a keymap layer and claims a slot on the context instead of
 * receiving an `api` object, and the theme is a nested semantic-token tree
 * rather than the V1 flat theme.
 */
async function setupTuiV2(ctx: V2TuiContext): Promise<() => void> {
  if (ctx.options?.enabled === false) return () => {}

  ctx.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "mem.status",
        title: "mem status",
        group: "Plugin",
        palette: true,
        slash: { name: "mem", aliases: ["status"], arguments: true },
        run() {
          ctx.ui.toast.show({ variant: "info", title: "Fractal Memory", message: statusMessage(), duration: 3000 })
        },
      },
    ],
  }))

  const unregister = ctx.ui.slot({
    append: "sidebar.content",
    render: () =>
      renderSidebar(() => {
        const theme = ctx.theme
        return {
          primary: theme.text.action.primary.base,
          textMuted: theme.text.muted,
          border: theme.border.base,
          backgroundPanel: theme.background.raised.base,
          success: theme.text.feedback.success.base,
          error: theme.text.feedback.error.base,
          warning: theme.text.feedback.warning.base,
        }
      }),
  })

  return () => unregister()
}

/**
 * Dual-shape TUI entrypoint.
 *
 * OpenCode 1.18.x calls `tui(api, options)`; OpenCode 2.x calls
 * `setup(ctx)`. The V1 loader rejects a module that exports BOTH `server()`
 * and `tui()` — this module only exports `tui`, so the two coexist safely.
 */
export default {
  id: "opencode-fractal-memory",
  setup: setupTuiV2,
  tui,
}
