import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { wrapWithTracking } from "./shared";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8")) as { version: string };
const VERSION = pkg.version;

export function MemoryVersion(store: MemoryStore) {
  const t = tool({
    description: "Show the installed version of the Fractal Memory plugin.",
    args: {},
    async execute() {
      return `Fractal Memory plugin version: ${VERSION}`;
    },
  });
  return wrapWithTracking(t, store, "memory_version");
}