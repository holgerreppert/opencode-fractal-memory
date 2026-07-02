#!/usr/bin/env bun
import * as path from "node:path";
import * as fs from "node:fs";
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
        fs.unlinkSync(pidFile);
      }
    });
  } catch (e) {
    memLog("warn", "management", "Failed to write PID file", { error: e instanceof Error ? e.message : e });
  }
}

const store = createSqliteMemoryStore(projectDir);

const router = new Router();
registerRoutes(router, store);

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const result = await router.handle(req);
    if (result) return result;

    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/") {
      return serveFile(path.join(publicDir, "index.html"));
    }

    const filePath = path.join(publicDir, pathname);
    if (filePath.startsWith(publicDir)) {
      return serveFile(filePath);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Management UI running at http://localhost:${port}`);
memLog("info", "management", `Management UI started on http://localhost:${port}`);
