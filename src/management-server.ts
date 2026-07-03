import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import { memLog } from "./logging";
import { Router } from "./management/router";
import { registerRoutes } from "./management/routes";
import { serveFile } from "./management/helpers";
import { createSqliteMemoryStore } from "./storage/sqlite";

interface ManagementConfig {
  enabled: boolean;
  port: number;
}

let activeProcess: import("bun").Subprocess | null = null;
let activeServer: http.Server | null = null;
let serverStore: ReturnType<typeof createSqliteMemoryStore> | null = null;

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

function findBunBinary(): string | null {
  // 1. Standard PATH check
  const fromPath = Bun.which("bun");
  if (fromPath) return fromPath;

  // 2. On Linux, /proc/self/exe may point to bun or a bun-adjacent binary
  try {
    if (process.platform === "linux") {
      const selfExe = fs.readlinkSync("/proc/self/exe");
      // If process IS bun, use it directly
      if (selfExe.endsWith("/bun")) return selfExe;
      // If it's another binary (e.g. opencode), look for bun alongside it
      const dir = path.dirname(selfExe);
      const sideBySide = path.join(dir, "bun");
      if (fs.existsSync(sideBySide)) return sideBySide;
      // Check parent bin directory
      const parentBin = path.join(path.resolve(dir, ".."), "bin", "bun");
      if (fs.existsSync(parentBin)) return parentBin;
    }
  } catch {
    // /proc/self/exe unavailable
  }

  // 3. Check common installation paths
  const commonPaths = [
    "/usr/local/bin/bun",
    "/usr/bin/bun",
    path.join(os.homedir(), ".bun", "bin", "bun"),
    path.join(os.homedir(), ".opencode", "bin", "bun"),
    path.join(os.homedir(), ".nvm", "versions", "node", process.versions.node || "", "bin", "bun"),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function findNodeBinary(): string | null {
  const fromPath = Bun.which("node");
  if (fromPath) return fromPath;

  const commonPaths = [
    "/usr/local/bin/node",
    "/usr/bin/node",
    path.join(os.homedir(), ".nvm", "versions", "node", process.versions.node || "", "bin", "node"),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function toWebRequest(req: http.IncomingMessage): Promise<Request> {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  const method = req.method || "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }
  }

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  return new Request(url.toString(), {
    method,
    headers,
    body: body?.length ? body : undefined,
  });
}

async function sendWebResponse(res: http.ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-length") {
      res.setHeader(key, value);
    }
  });

  if (webRes.body) {
    try {
      const reader = webRes.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(value);
        }
      };
      await pump();
    } catch (err) {
      if (!res.destroyed) res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  } else {
    res.end();
  }
}

function startInProcess(directory: string, port: number): void {
  try {
    const store = createSqliteMemoryStore(directory);
    serverStore = store;

    const router = new Router();
    registerRoutes(router, store);

    const publicDir = path.join(__dirname, "..", "management", "public");

    const server = http.createServer(async (req, res) => {
      try {
        const webReq = await toWebRequest(req);
        const result = await router.handle(webReq);
        if (result) {
          await sendWebResponse(res, result);
          return;
        }

        const url = new URL(webReq.url);
        const pathname = url.pathname;

        if (pathname === "/") {
          const fileRes = serveFile(path.join(publicDir, "index.html"));
          await sendWebResponse(res, fileRes);
          return;
        }

        const filePath = path.join(publicDir, pathname);
        if (filePath.startsWith(publicDir)) {
          const fileRes = serveFile(filePath);
          await sendWebResponse(res, fileRes);
          return;
        }

        res.statusCode = 404;
        res.end("Not found");
      } catch (err) {
        memLog("error", "management", "Request error", { error: err instanceof Error ? err.message : String(err) });
        res.statusCode = 500;
        res.end("Internal server error");
      }
    });

    server.listen(port, "127.0.0.1", () => {
      memLog("info", "management", `Management server started in-process on http://localhost:${port}`);
    });

    activeServer = server;
  } catch (err) {
    memLog("error", "management", "Failed to start in-process management server", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function trySpawnSubprocess(interpreterPath: string, standalonePath: string, directory: string, port: number, label: string): boolean {
  try {
    memLog("info", "management", `Spawning with ${label}`, { interpreter: interpreterPath, script: standalonePath });
    const proc = Bun.spawn([interpreterPath, standalonePath], {
      env: {
        ...process.env,
        MGMT_PORT: String(port),
        MGMT_PROJECT_DIR: directory,
        MGMT_PID_FILE: PID_FILE,
      },
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      deathSignal: "SIGKILL" as any,
    } as any);

    activeProcess = proc;

    memLog("info", "management", `${label} spawn succeeded`, { pid: proc.pid });

    proc.exited.then((code: number) => {
      memLog("info", "management", `Management server (${label}) exited (code: ${code})`);
      if (activeProcess === proc) activeProcess = null;
    });

    memLog("info", "management", `Management server started on http://localhost:${port} (pid: ${proc.pid}, ${label})`);
    return true;
  } catch (err) {
    memLog("warn", "management", `Failed to spawn with ${label}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
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

  if (activeProcess || activeServer) {
    memLog("warn", "management", "Management server already running, stopping old instance");
    stopManagementServer();
  }

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

  // Spawn chain: bun → node → in-process
  const bunPath = findBunBinary();
  if (bunPath) {
    if (trySpawnSubprocess(bunPath, standalonePath, directory, config.port, "bun")) return;
  }

  const nodePath = findNodeBinary();
  if (nodePath) {
    memLog("info", "management", "bun not available, trying node", { nodePath });
    if (trySpawnSubprocess(nodePath, standalonePath, directory, config.port, "node")) return;
  }

  memLog("info", "management", "Neither bun nor node available as subprocess, starting in-process");
  startInProcess(directory, config.port);
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
  if (activeServer) {
    try {
      activeServer.close();
      memLog("info", "management", "In-process management server stopped");
    } catch (err) {
      memLog("warn", "management", "Error stopping in-process management server", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    activeServer = null;
  }
  if (serverStore) {
    try {
      serverStore = null;
    } catch {
      // best-effort
    }
  }
}

process.on("exit", stopManagementServer);
process.on("SIGINT", stopManagementServer);
process.on("SIGTERM", stopManagementServer);
