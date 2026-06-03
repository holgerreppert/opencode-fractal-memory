import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { wrapWithTracking } from "./shared";

const VERSION = "0.2.0";

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