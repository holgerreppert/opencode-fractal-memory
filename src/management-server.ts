import * as path from "node:path";
import { memLog } from "./logging";

interface ManagementConfig {
  enabled: boolean;
  port: number;
}

let activeProcess: import("bun").Subprocess | null = null;

export function startManagementServer(
  _store: unknown,
  directory: string,
  config: ManagementConfig,
): void {
  if (activeProcess) {
    memLog("warn", "management", "Management server already running, killing old instance");
    stopManagementServer();
  }

  const standalonePath = path.join(__dirname, "management-standalone.js");

  try {
    const proc = Bun.spawn(["bun", standalonePath], {
      env: {
        ...process.env,
        MGMT_PORT: String(config.port),
        MGMT_PROJECT_DIR: directory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

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
      activeProcess.kill("SIGTERM");
      memLog("info", "management", `Management server process ${activeProcess.pid} killed`);
    } catch (err) {
      memLog("warn", "management", "Error killing management server", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    activeProcess = null;
  }
}
