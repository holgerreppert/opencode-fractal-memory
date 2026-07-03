import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { memLog } from "./logging";

interface ManagementConfig {
  enabled: boolean;
  port: number;
}

let activeProcess: import("bun").Subprocess | null = null;

let mgmtConfig: { enabled: boolean; port: number; directory: string } | null = null;

try {
  memLog("info", "management", "Module loaded, runtime check", {
    bunType: typeof Bun,
    nodeVersion: process.versions.node,
    runtime: typeof Bun !== "undefined" ? "bun" : "node",
  });
} catch {
  // module-level logging should never throw
}

const PID_FILE = path.join(os.homedir(), ".config", "opencode", "management-server.pid");

function killOrphanedServer(_port: number): void {
  if (!fs.existsSync(PID_FILE)) return;
  try {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (oldPid > 0) {
      try {
        process.kill(oldPid, 0);
        process.kill(oldPid, "SIGKILL");
        memLog("info", "management", `Killed orphaned management server (pid: ${oldPid})`);
      } catch {
        memLog("debug", "management", "Orphaned process already exited or inaccessible");
      }
    }
  } catch (e) {
    memLog("warn", "management", "Failed to read PID file", { error: String(e) });
  }
}

export function ensureManagementServer(): void {
  memLog("info", "management", "ensureManagementServer called", { hasConfig: !!mgmtConfig, enabled: mgmtConfig?.enabled });
  if (mgmtConfig && mgmtConfig.enabled) {
    startManagementServer(null, mgmtConfig.directory, { enabled: true, port: mgmtConfig.port });
  }
}

export function startManagementServer(
  _store: unknown,
  directory: string,
  config: ManagementConfig,
): void {
  memLog("info", "management", "startManagementServer called", { port: config.port, dir: directory });

  if (activeProcess) {
    memLog("warn", "management", "Management server already running, killing old instance");
    stopManagementServer();
  }

  // Kill any orphaned server from a previous session (PID file + graceful shutdown)
  killOrphanedServer(config.port);
  try {
    fetch(`http://127.0.0.1:${config.port}/api/shutdown`).catch(() => {
      memLog("debug", "management", "Shutdown endpoint unreachable (expected if server not running)");
    });
  } catch (e) {
    memLog("debug", "management", "Shutdown request failed", { error: String(e) });
  }

  const standalonePath = path.join(__dirname, "management-standalone.js");
  memLog("info", "management", "Resolved standalone path", { standalonePath });

  const exists = fs.existsSync(standalonePath);
  memLog("info", "management", "Standalone file exists check", { exists, dirname: __dirname });

  mgmtConfig = { enabled: config.enabled, port: config.port, directory };

  const bunInPath = Bun.which("bun");
  memLog("info", "management", "Checking Bun availability", { hasBun: typeof Bun !== "undefined", bunInPath: !!bunInPath });

  if (typeof Bun === "undefined") {
    memLog("error", "management", "Bun is not defined — cannot spawn management server");
    return;
  }

  if (!bunInPath) {
    memLog("warn", "management", "bun not found in PATH — management server unavailable");
    return;
  }

  try {
    memLog("info", "management", "Calling Bun.spawn", { script: standalonePath, bunPath: bunInPath });
    const proc = Bun.spawn([bunInPath, standalonePath], {
      env: {
        ...process.env,
        MGMT_PORT: String(config.port),
        MGMT_PROJECT_DIR: directory,
        MGMT_PID_FILE: PID_FILE,
      },
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      deathSignal: "SIGKILL" as any,
    } as any);

    activeProcess = proc;

    memLog("info", "management", "Bun.spawn returned successfully", { pid: proc.pid });

    proc.exited.then((code: number) => {
      memLog("info", "management", `Management server exited (code: ${code})`);
      if (activeProcess === proc) activeProcess = null;
    });

    memLog("info", "management", `Management server started on http://localhost:${config.port} (pid: ${proc.pid})`);
  } catch (err) {
    memLog("error", "management", "Failed to start management server", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      standalonePath,
    });
  }
}

export function stopManagementServer(): void {
  if (activeProcess) {
    try {
      activeProcess.kill("SIGKILL");
      memLog("info", "management", `Management server process ${activeProcess.pid} killed`);
    } catch (err) {
      memLog("warn", "management", "Error killing management server", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    activeProcess = null;
  }
}

process.on("exit", stopManagementServer);
process.on("SIGINT", stopManagementServer);
process.on("SIGTERM", stopManagementServer);
