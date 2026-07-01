import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import type { HookHandler } from "./types";

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
        const results = await store.drilldownQuery(userText, 3);
        if (results.length === 0) return;

        const memoryBlock = results
          .filter(r => r.node?.content)
          .slice(0, 3)
          .map((r, i) => {
            const label = r.node?.label ?? r.node?.id ?? `memory-${i}`;
            const content = (r.node?.content ?? "").slice(0, 300);
            return `[Memory ${i + 1}] ${label}: ${content}`;
          })
          .join("\n\n");

        if (!memoryBlock) return;

        out.messages.splice(out.messages.length - 1, 0, {
          info: { role: "user" },
          parts: [{ type: "text" as const, text: `[Relevant context from memory]\n${memoryBlock}` }],
        });
      } catch (err) {
        memLog("debug", "messages-transform", "Memory injection via messages.transform failed", {
          error: String(err),
        });
      }
    },
  };
}
