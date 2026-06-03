import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { getWorkingCache } from "../cache";
import { wrapWithTracking } from "./shared";

export function MemoryCacheStatus(store: MemoryStore) {
  const t = tool({
    description: "Show current working-memory cache usage (size, max size, recent files).",
    args: {},
    async execute(_args) {
      const cache = getWorkingCache("dashboard");
      const maxSize = 8;
      const ttlHours = 2;

      const lines: string[] = [
        "## Working Memory Cache",
        "",
        `Current size: ${cache.length} / ${maxSize}`,
        `TTL: ${ttlHours} hours`,
        "",
      ];

      if (cache.length === 0) {
        lines.push("Cache is empty. Nodes are added to the working cache as they are accessed during a session.");
        return lines.join("\n");
      }

      lines.push("### Cached Nodes");
      lines.push("| Label | Importance | Cached At |");
      lines.push("|-------|------------|-----------|");
      for (const n of cache) {
        const date = new Date(n.cachedAt).toLocaleString();
        lines.push(`| ${n.label} | ${n.importance.toFixed(2)} | ${date} |`);
      }

      lines.push("");
      lines.push("_Cache entries expire after ${ttlHours} hours or when the cache exceeds ${maxSize} entries._");

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_cache_status");
}
