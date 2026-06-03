#!/usr/bin/env bun
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryMcpServer } from "./mcp/server";
import { mcpLog } from "./mcp/logging";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")) as { version: string };

const projectDir = process.env.MGMT_PROJECT_DIR || process.cwd();
const globalDbPath = path.join(os.homedir(), ".config", "opencode", "memory.db");

async function main() {
  mcpLog("info", "MCP server starting", { name: "opencode-fractal-memory", version: pkg.version });
  const server = await createMemoryMcpServer(projectDir, globalDbPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  mcpLog("info", "MCP server connected");
}

if (import.meta.main) {
  main().catch(console.error);
}
