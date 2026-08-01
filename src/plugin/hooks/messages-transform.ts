import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { getPressurePhase } from "../../application/adaptive-pressure";
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

export function createMessagesTransformHandler(
  store: MemoryStore,
  config: MemConfig,
  currentSessionId: { value: string },
): HookHandler {
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

        const apConfig = config.adaptivePressure;
        const phase = apConfig?.enabled ? getPressurePhase(apConfig) : "normal";

        let filtered = results.filter(r => r.node?.content);
        if (phase === "aggressive" || phase === "critical") {
          const minImp = phase === "critical" ? 0.8 : 0.6;
          filtered = filtered.filter(r => (r.node?.importance ?? 0) >= minImp);
          if (results.length - filtered.length > 0) {
            memLog("debug", "messages-transform", `Pressure-aware filter: skipped ${results.length - filtered.length}/${results.length} low-importance nodes (phase=${phase})`);
          }
        }

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

        const injectedNodes = filtered.slice(0, 3);
        const nodeTypes: Record<string, number> = {};
        for (const r of injectedNodes) {
          const t = r.node?.type ?? "unknown";
          nodeTypes[t] = (nodeTypes[t] ?? 0) + 1;
        }

        const injectedContent = injectedNodes.map(r => ({
          label: r.node?.label ?? r.node?.id ?? "unknown",
          type: r.node?.type ?? "unknown",
          snippet: (r.node?.content ?? "").slice(0, 300),
        }));

        store.logInjectionMetrics(currentSessionId.value, {
          injectedNodeCount: injectedNodes.length,
          injectedTokens: injectedNodes.reduce((s, r) => s + ((r.node?.content?.length ?? 0) / 4), 0),
          injectionMode: "messages_transform",
          queryText: userText.slice(0, 200),
          injectedNodeTypes: nodeTypes,
          injectedContent,
        }).catch((err: unknown) => memLog("warn", "messages-transform", `injection metric error: ${String(err)}`));

        memLog("debug", "messages-transform", "Injected structured memory context", {
          count: injectedNodes.length,
          labels: injectedNodes.map(r => r.node?.label).join(", "),
          phase,
        });
      } catch (err) {
        memLog("debug", "messages-transform", "Memory injection via messages.transform failed", {
          error: String(err),
        });
      }
    },
  };
}
