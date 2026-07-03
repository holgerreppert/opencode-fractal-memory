#!/usr/bin/env node
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import { memLog } from "./logging";
import { Router } from "./management/router";
import { registerRoutes } from "./management/routes";
import { serveFile } from "./management/helpers";
import { createSqliteMemoryStore } from "./storage/sqlite";

const port = parseInt(process.env.MGMT_PORT || "8787");
const projectDir = process.env.MGMT_PROJECT_DIR || process.cwd();
const publicDir = path.join(__dirname, "..", "management", "public");

// Write PID file so the next session can kill this orphaned server
const pidFile = process.env.MGMT_PID_FILE || "";
if (pidFile) {
  try {
    fs.writeFileSync(pidFile, String(process.pid));
    process.on("exit", () => {
      if (fs.existsSync(pidFile)) {
        try { fs.unlinkSync(pidFile); } catch { /* best-effort */ }
      }
    });
  } catch (e) {
    memLog("warn", "management", "Failed to write PID file", { error: e instanceof Error ? e.message : e });
  }
}

const store = createSqliteMemoryStore(projectDir);

const router = new Router();
registerRoutes(router, store);

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
  console.log(`Management UI running at http://localhost:${port}`);
  memLog("info", "management", `Management UI started on http://localhost:${port}`);
});
