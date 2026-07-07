import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import type { HookHandler } from "./types";

interface MemoryNode {
  label?: string | null;
  id?: string;
  content?: string | null;
  type?: string | null;
  importance?: number | null;
  usefulnessScore?: number | null;
}

interface QueryResult {
  node?: MemoryNode | null;
  score?: number;
}

function formatMemoryBlock(results: QueryResult[]): string {
  const lines: string[] = [];
  lines.push("<memory_context>");
  for (const r of results) {
    const node = r.node;
    if (!node?.content) continue;
    const label = node.label ?? node.id ?? "unknown";
    const type = node.type ?? "note";
    const importance = node.importance ?? 0.5;
    const snippet = (node.content ?? "").slice(0, 300);
    lines.push(`  <entry label="${label}" type="${type}" importance="${importance.toFixed(2)}">`);
    lines.push(`    ${snippet}`);
    lines.push(`  </entry>`);
  }
  lines.push("</memory_context>");
  return lines.join("\n");
}

export function createMessagesTransformHandler(store: MemoryStore, config: MemConfig): HookHandler {
  const arConfig = config.autoRetrieve;
  if (!arConfig?.enabled) {
    return {};
  }

  return {
    "chat.messages.transform": async (_input: unknown, output: unknown) => {
      const out = output as {
        messages: Array<{ info: { role?: string }; parts: Array<{ type?: string; text?: string }> }>;
      };

      if (!out.messages || out.messages.length < 3) return;

      const lastUserMsg = [...out.messages].reverse().find(m => m.info?.role === "user");
      if (!lastUserMsg) return;

      const userText = lastUserMsg.parts?.filter(p => p.type === "text").map(p => p.text).join(" ") ?? "";
      if (!userText || userText.length < 10) return;

      try {
        const results = (await store.drilldownQuery(userText, 5)) as QueryResult[];
        const filtered = results.filter(r => r.node?.content);
        if (filtered.length === 0) return;

        const memoryBlock = formatMemoryBlock(filtered.slice(0, 3));
        if (!memoryBlock) return;

        out.messages.splice(out.messages.length - 1, 0, {
          info: { role: "user" },
          parts: [{
            type: "text" as const,
            text: `[Relevant context from memory]\n${memoryBlock}`,
          }],
        });

        memLog("debug", "messages-transform", "Injected structured memory context", {
          count: filtered.slice(0, 3).length,
          labels: filtered.slice(0, 3).map(r => r.node?.label).join(", "),
        });
      } catch (err) {
        memLog("debug", "messages-transform", "Memory injection via messages.transform failed", {
          error: String(err),
        });
      }
    },
  };
}
