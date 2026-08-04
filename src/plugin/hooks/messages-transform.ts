import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { getPressurePhase } from "../../application/adaptive-pressure";
import { injectionMarker, recordInjection } from "../../application/injection-visibility";
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
        const results = (await store.drilldownQuery(userText, 5, store.projectName)) as QueryResult[];

        const apConfig = config.adaptivePressure;
        const phase = apConfig?.enabled ? getPressurePhase(apConfig) : "normal";

        // Importance gate: autoInjection.minScore applies in ALL phases.
        // Stale group summaries (level >= 1) decay via the multiplicative
        // recency penalty in computeRRFScores, landing well below this gate,
        // so they no longer get injected every turn. Pressure-aware phases
        // raise the bar further (0.6 aggressive / 0.8 critical).
        const baseMinImp = config.autoInjection?.minScore ?? config.autoRetrieve?.minInjectionScore ?? 0.05;
        const minImp = phase === "critical" ? 0.8 : phase === "aggressive" ? Math.max(0.6, baseMinImp) : baseMinImp;

        let filtered = results.filter(r => r.node?.content);
        const preGateCount = filtered.length;
        filtered = filtered.filter(r => (r.node?.importance ?? 0) >= minImp);
        if (preGateCount - filtered.length > 0) {
          memLog("debug", "messages-transform", `Importance gate: skipped ${preGateCount - filtered.length}/${preGateCount} low-importance nodes (min=${minImp}, phase=${phase})`);
        }

        if (filtered.length === 0) return;

        const memoryBlock = formatMemoryBlock(filtered.slice(0, 3));
        if (!memoryBlock) return;

        const injectedNodes = filtered.slice(0, 3);
        const marker = injectionMarker(config, "memory-context", `${injectedNodes.length} node(s), phase=${phase}`) + "\n";
        const body = `${marker}[Relevant context from memory]\n${memoryBlock}`;
        recordInjection(config, "memory-context", `${injectedNodes.length} node(s): ${injectedNodes.map(r => r.node?.label ?? r.node?.id).join(", ")} (phase=${phase})`);

        out.messages.splice(out.messages.length - 1, 0, {
          info: { role: "user" },
          parts: [{
            type: "text" as const,
            text: body,
          }],
        });
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
