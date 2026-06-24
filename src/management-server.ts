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

const PID_FILE = path.join(os.homedir(), ".config", "opencode", "management-server.pid");

function killOrphanedServer(port: number): void {
  // Try to read PID file and kill the old process
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (oldPid > 0) {
        try {
          process.kill(oldPid, 0); // check if alive
          process.kill(oldPid, "SIGKILL");
          memLog("info", "management", `Killed orphaned management server (pid: ${oldPid})`);
        } catch {
          // not alive or no permission — ignore
        }
      }
    }
  } catch { }
}

export function ensureManagementServer(): void {
  if (mgmtConfig && mgmtConfig.enabled) {
    startManagementServer(null, mgmtConfig.directory, { enabled: true, port: mgmtConfig.port });
  }
}

export function startManagementServer(
  _store: unknown,
  directory: string,
  config: ManagementConfig,
): void {
  if (activeProcess) {
    memLog("warn", "management", "Management server already running, killing old instance");
    stopManagementServer();
  }

  // Kill any orphaned server from a previous session (PID file + graceful shutdown)
  killOrphanedServer(config.port);
  try {
    fetch(`http://127.0.0.1:${config.port}/api/shutdown`).catch(() => {});
  } catch {}

  const standalonePath = path.join(__dirname, "management-standalone.js");

  mgmtConfig = { enabled: config.enabled, port: config.port, directory };

  try {
    const proc = Bun.spawn(["bun", standalonePath], {
      env: {
        ...process.env,
        MGMT_PORT: String(config.port),
        MGMT_PROJECT_DIR: directory,
        MGMT_PID_FILE: PID_FILE,
      },
      stdio: ["ignore", "pipe", "pipe"],
      deathSignal: "SIGKILL" as any,
    } as any);

    activeProcess = proc;

    proc.exited.then((code) => {
      memLog("info", "management", `Management server exited (code: ${code})`);
      if (activeProcess === proc) activeProcess = null;
    });

    memLog("info", "management", `Management server started on http://localhost:${config.port} (pid: ${proc.pid})`);
  } catch (err) {
    memLog("error", "management", "Failed to start management server", {
      error: err instanceof Error ? err.message : String(err),
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
