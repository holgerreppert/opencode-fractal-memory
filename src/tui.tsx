/** @jsxImportSource @opentui/solid */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Context as TuiContext } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { getLatestPressureSync } from "./storage/sync-pressure"

declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
  }
}

const CONTEXT_LIMIT = 128000

interface MgmtStatus {
  enabled: boolean
  port: number
  url: string
  running: boolean
  pid: number | null
}

function getMgmt(): MgmtStatus {
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
      const parsed = parseInt(txt, 10)
      if (parsed > 0) {
        process.kill(parsed, 0)
        pid = parsed
        running = true
      }
    }
  } catch { running = false }
  return { enabled, port, url, running, pid }
}

/** True when the port answers HTTP at all — the authoritative liveness check. */
async function probePort(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

/**
 * Sync pid-file state + async port probe. The pid file alone is unreliable:
 * a spawn race used to delete it while the server kept running, which made
 * the sidebar read "stopped" forever. A live port is the ground truth.
 */
async function refreshMgmt(): Promise<MgmtStatus> {
  const base = getMgmt()
  if (!base.enabled) return base
  const up = await probePort(base.url)
  return { ...base, running: base.running || up }
}

function getPressure(): { pressure_pct: number; total_tokens: number; timestamp: number; session_id: string } | null {
  return getLatestPressureSync()
}

function bar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width)
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(width - filled, 0))
}

/** Text of the `/mem` status command. */
async function statusMessage(): Promise<string> {
  const m = await refreshMgmt()
  const p = getPressure()
  return `${m.enabled ? "ON" : "OFF"} ${m.url} ${m.running ? "● running" : "○ stopped"}${p ? ` | ${p.pressure_pct}% ${p.total_tokens.toLocaleString()}/${CONTEXT_LIMIT.toLocaleString()}` : ""}`
}

/**
 * Colors for the sidebar box.
 *
 * The runtime exposes nested semantic tokens whose values are RGBA objects.
 * They are passed through to the OpenTUI color props.
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
 * inside the reactive scope.
 */
function renderSidebar(getColors: () => SidebarColors, getMgmtState: () => MgmtStatus) {
  const skin = getColors()
  const m = getMgmtState()
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
 * Terminal-client entrypoint.
 *
 * The CLI plugin registers a keymap layer and claims a slot on the context.
 */
async function setupTui(ctx: TuiContext): Promise<() => void> {
  if (ctx.options?.enabled === false) {
    return () => {
      // disabled — nothing was registered
    };
  }

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
          // Return the promise so callers (and tests) can await the toast.
          return statusMessage().then((message) =>
            ctx.ui.toast.show({ variant: "info", title: "Fractal Memory", message, duration: 3000 }),
          ).catch(() => { /* toast is best-effort */ });
        },
      },
    ],
  }))

  // Re-check management liveness + pressure on an interval so the sidebar
  // self-corrects after a cold service start (the first render can happen
  // before the server plugin has spawned the management server, which
  // previously latched "○ stopped" for the whole session). Reading the
  // signal inside render subscribes the slot to updates. The pid file alone
  // is not trusted — a live port probe is the ground truth.
  const [mgmtState, setMgmtState] = createSignal<MgmtStatus>(getMgmt())
  const refresh = () => { void refreshMgmt().then(setMgmtState).catch(() => { /* keep last state */ }) }
  refresh()
  const timer = setInterval(refresh, 3000)

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
      }, mgmtState),
  })

  return () => {
    clearInterval(timer)
    unregister()
  }
}

/**
 * Terminal-client entrypoint.
 *
 * The runtime resolves the package's `tui` entrypoint and calls `setup(ctx)`.
 */
export default {
  id: "opencode-fractal-memory",
  setup: setupTui,
}
