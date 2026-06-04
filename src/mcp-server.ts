#!/usr/bin/env bun
import * as path from "node:path";
import * as os from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryMcpServer } from "./mcp/server";
import { mcpLog } from "./mcp/logging";
import { VERSION } from "./version";

const projectDir = process.env.MGMT_PROJECT_DIR || process.cwd();
const globalDbPath = path.join(os.homedir(), ".config", "opencode", "memory.db");

async function main() {
  mcpLog("info", "MCP server starting", { name: "opencode-fractal-memory", version: VERSION });
  const server = await createMemoryMcpServer(projectDir, globalDbPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  mcpLog("info", "MCP server connected");
}

if (import.meta.main) {
  main().catch(console.error);
}
