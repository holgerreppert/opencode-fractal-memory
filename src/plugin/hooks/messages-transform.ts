import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import type { MemoryNode as StoredMemoryNode } from "../../storage/types";
import { getPressurePhase } from "../../application/adaptive-pressure";
import { injectionMarker, recordInjection } from "../../application/injection-visibility";
import { getActiveRerankMode } from "../../application/dream-rsi";
import { rerank } from "../../application/ranking/rerank";
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
  level?: "summary" | "intermediate" | "detail";
}

interface PendingInjection {
  label: string;
  turn: number;
}

// Usefulness feedback loop: an injection is judged once, by observed agent
// behavior — not by asking. Used (agent passes the id/label into a memory
// tool, or cites the label in its own text) → usefulness +0.5, timesHelpful
// +1. Ignored past a grace window (3 turns, so slow agents aren't punished)
// → usefulness −0.25, floored at 0. Scale is 0–5 (ranking normalizes /5).
const USEFULNESS_BUMP = 0.5;
const USEFULNESS_DECAY = 0.25;
const JUDGE_GRACE_TURNS = 3;
const MIN_LABEL_MATCH_LEN = 8;

interface HookPart {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface HookMessage {
  info?: { role?: string };
  parts?: HookPart[];
}

/** Our own injected blocks also carry labels — never count those as "use". */
function isOwnInjectionText(text: string): boolean {
  return text.includes("<memory_context>") || text.includes("Reranked Memory Results");
}

/**
 * Band-preserving top-K: order candidates by the learned rerank mode but
 * keep at most `capPerLevel` entries per drilldown level so the
 * summary/intermediate/detail mix survives the reorder. Fill priority:
 * ranked∩cap → original∩cap → ranked → original, so diversity wins over
 * rank and the result is never shorter than min(take, results.length).
 */
function bandPreservingTop(
  results: QueryResult[],
  rankedIds: string[],
  take: number,
  capPerLevel: number,
): QueryResult[] {
  const byId = new Map<string, QueryResult>();
  for (const r of results) {
    if (r.node?.id) byId.set(r.node.id, r);
  }
  const out: QueryResult[] = [];
  const counts: Record<string, number> = {};
  const tryPush = (r: QueryResult, cap: boolean): void => {
    if (out.includes(r) || out.length >= take) return;
    const lvl = r.level ?? "detail";
    if (cap && (counts[lvl] ?? 0) >= capPerLevel) return;
    counts[lvl] = (counts[lvl] ?? 0) + 1;
    out.push(r);
  };
  const ranked = rankedIds.map(id => byId.get(id)).filter((r): r is QueryResult => r !== undefined);
  const passes: Array<Array<QueryResult>> = [ranked, results, ranked, results];
  for (let p = 0; p < passes.length && out.length < take; p++) {
    const cap = p < 2;
    for (const r of passes[p]!) {
      tryPush(r, cap);
      if (out.length >= take) break;
    }
  }
  return out;
}

async function judgePriorInjections(
  store: MemoryStore,
  pending: Map<string, PendingInjection>,
  turn: number,
  messages: HookMessage[],
  sessionId: string,
): Promise<void> {
  if (pending.size === 0) return;
  // Evidence = what the AGENT did: memory-tool inputs + its own text.
  // Tool results and our injected blocks are excluded (self-match).
  const evidence: string[] = [];
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type === "tool_use" && (p.name === "memory" || p.name?.startsWith("memory_")) && p.input !== undefined) {
        try {
          evidence.push(JSON.stringify(p.input));
        } catch {
          // ignore unserializable input
        }
      } else if ((p.type === "text" || p.type === "reasoning") && m.info?.role === "assistant" && p.text && !isOwnInjectionText(p.text)) {
        evidence.push(p.text);
      }
    }
  }
  for (const [id, p] of pending) {
    const used = evidence.some(h => h.includes(id) || (p.label.length >= MIN_LABEL_MATCH_LEN && h.includes(p.label)));
    try {
      if (used) {
        const node = await store.getNode(id).catch(() => null);
        if (node) {
          await store.updateNode(id, {
            usefulnessScore: Math.min(5, (node.usefulnessScore ?? 0) + USEFULNESS_BUMP),
            timesHelpful: (node.timesHelpful ?? 0) + 1,
          }).catch(() => { /* node may be deleted concurrently */ });
          memLog("debug", "messages-transform", "Usefulness +: injected node was used by the agent", { label: p.label });
        }
        pending.delete(id);
        try {
          await store.recordInjectionNodeVerdict(sessionId, id, true);
        } catch { /* metrics verdict is best-effort */ }
      } else if (turn - p.turn >= JUDGE_GRACE_TURNS) {
        const node = await store.getNode(id).catch(() => null);
        if (node) {
          await store.updateNode(id, {
            usefulnessScore: Math.max(0, (node.usefulnessScore ?? 0) - USEFULNESS_DECAY),
          }).catch(() => { /* ignore */ });
          memLog("debug", "messages-transform", "Usefulness −: injected node ignored past grace window", { label: p.label });
        }
        pending.delete(id);
        try {
          await store.recordInjectionNodeVerdict(sessionId, id, false);
        } catch { /* metrics verdict is best-effort */ }
      }
    } catch {
      // judging must never break injection
    }
  }
}

function formatMemoryBlock(results: QueryResult[]): string {
  const lines: string[] = [];
  const labels: string[] = [];
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
    labels.push(label);
  }
  lines.push("</memory_context>");
  // Explicit rating invitation: the agent is aware of rating only if asked.
  // One compact line (~30 tokens); labels listed so one call per entry works.
  if (labels.length > 0) {
    lines.push(`<!-- If an entry helped your answer — or wasted tokens on irrelevance — rate it (one call per entry): learn(mode="rate", label="<entry-label>", helpful=true|false). Entries: ${labels.join(", ")} -->`);
  }
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

  // Per-session injection ledger: a node injected once in a session is never
  // re-injected in the same session (anti-flood dedup), AND each injection
  // is judged exactly once by the usefulness feedback loop above (used →
  // bump, ignored past grace → decay). The old multiplicative recency
  // penalty (0.3 floor) suppressed ALL injection of durable knowledge
  // instead of just preventing repeats. Dedup lets a relevant old node be
  // injected exactly once per session, then makes room for the next-best
  // candidates on later turns.
  const injectedPerSession = new Map<string, Set<string>>();
  const pendingJudge = new Map<string, Map<string, PendingInjection>>();
  const turnBySession = new Map<string, number>();
  // OpenCode re-fires chat.messages.transform on every tool-loop LLM request
  // with the same last user text — dedup so drilldownQuery (3 hybrid searches
  // each) doesn't re-run several times per second for an unchanged query.
  const DRILLDOWN_TTL_MS = 30_000;
  const drilldownCache = new Map<string, { at: number; results: QueryResult[] }>();

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

      const sessionId = currentSessionId?.value || "default";
      try {
        const cacheKey = `${sessionId} ${userText}`;
        const now = Date.now();
        let cached = drilldownCache.get(cacheKey);
        if (cached && now - cached.at > DRILLDOWN_TTL_MS) {
          drilldownCache.delete(cacheKey);
          cached = undefined;
        }
        if (!cached && drilldownCache.size > 32) {
          const oldest = drilldownCache.keys().next().value;
          if (oldest !== undefined) drilldownCache.delete(oldest);
        }
        let results: QueryResult[];
        if (cached) {
          results = cached.results;
        } else {
          results = (await store.drilldownQuery(userText, 5, store.projectName)) as QueryResult[];
          drilldownCache.set(cacheKey, { at: now, results });
        }

        const apConfig = config.adaptivePressure;
        const phase = apConfig?.enabled ? getPressurePhase(apConfig) : "normal";

        // Importance gate: ranking.gate.minScore applies in ALL phases.
        // Importance is the calibrated linear-model relevance ([0,1],
        // absolute scale) — recency no longer multiplies it, so old-but-
        // relevant nodes can pass. Pressure-aware phases raise the bar
        // further (0.6 aggressive / 0.8 critical). Repeats are handled by
        // the per-session dedup below, not by score decay.
        const baseMinImp = config.autoInjection?.minScore ?? config.autoRetrieve?.minInjectionScore ?? config.ranking?.gate?.minScore ?? 0.3;
        const minImp = phase === "critical" ? 0.8 : phase === "aggressive" ? Math.max(0.6, baseMinImp) : baseMinImp;

        let seen = injectedPerSession.get(sessionId);
        if (!seen) {
          seen = new Set<string>();
          injectedPerSession.set(sessionId, seen);
          if (injectedPerSession.size > 32) {
            injectedPerSession.delete(injectedPerSession.keys().next().value as string);
          }
        }
        let pending = pendingJudge.get(sessionId);
        if (!pending) {
          pending = new Map<string, PendingInjection>();
          pendingJudge.set(sessionId, pending);
        }
        const turn = (turnBySession.get(sessionId) ?? 0) + 1;
        turnBySession.set(sessionId, turn);

        // Judge prior injections by observed use before retrieving new ones.
        // Judging consumes the pending entry but never touches the dedup set.
        try {
          await judgePriorInjections(store, pending, turn, out.messages, sessionId);
        } catch {
          // judging must never break injection
        }

        // Reference-type nodes (default: research) are browsed, not injected:
        // they match keywords (e.g. anything about "memory") while missing
        // task intent, and their size dominates the injection budget.
        const excludedTypes = new Set(arConfig.excludeTypes ?? ["research"]);
        let filtered = results.filter(r => r.node?.content && !(r.node?.id && seen.has(r.node.id)) && !(r.node?.type && excludedTypes.has(r.node.type)));
        const preGateCount = filtered.length;
        filtered = filtered.filter(r => (r.node?.importance ?? 0) >= minImp);
        if (preGateCount - filtered.length > 0) {
          memLog("debug", "messages-transform", `Importance gate: skipped ${preGateCount - filtered.length}/${preGateCount} low-importance nodes (min=${minImp}, phase=${phase})`);
        }

        if (filtered.length === 0) return;

        // Learned strategy application (Dream-RSI loop closure): when replay
        // has crowned a rerank strategy, reorder the drilldown candidates by
        // that mode before the top-3 cut; the row then logs the applied mode
        // so replay attributes feedback to the pipeline that really ran.
        // Drilldown winner or no learned mode → natural level-banded order.
        // Failure falls back to drilldown order — injection never breaks.
        let injectedNodes = filtered.slice(0, 3);
        let appliedStrategy = "drilldown";
        // Exploration quota (Dream-RSI rule 3): a share of injections skips
        // the learned mode so the window keeps getting drilldown-produced
        // rows — without counterfactual data the incumbent's neutral self
        // rows (agreement 0.8) hold the seat forever under hysteresis.
        const explorationRate = config.dreamRsi?.explorationRate ?? 0.2;
        const exploring = config.dreamRsi?.applyToInjection !== false
          && explorationRate > 0
          && Math.random() < explorationRate;
        if (exploring) {
          memLog("debug", "messages-transform", `exploration quota hit (rate=${explorationRate}): keeping drilldown order for counterfactual row`);
        } else if (config.dreamRsi?.applyToInjection !== false) {
          try {
            const learnedMode = await getActiveRerankMode(store);
            if (learnedMode !== undefined && filtered.length > 1) {
              const candidates = filtered
                .map(r => r.node)
                .filter((n): n is MemoryNode => n !== null && n !== undefined);
              const ranked = await rerank({
                mode: learnedMode,
                query: userText,
                candidates: candidates as unknown as StoredMemoryNode[],
                topK: Math.min(3, candidates.length),
              });
              if (ranked.length > 0) {
                const ordered = bandPreservingTop(filtered, ranked.map(n => n.id), 3, 2);
                // Attribute only when the order actually changed — if rerank
                // was a no-op (too few candidates), the row is drilldown's.
                const changed = ordered.some((r, i) => r !== injectedNodes[i]) || ordered.length !== injectedNodes.length;
                if (changed) {
                  injectedNodes = ordered;
                  appliedStrategy = learnedMode;
                }
              }
            }
          } catch (err) {
            memLog("debug", "messages-transform", `learned rerank unavailable, keeping drilldown order: ${String(err)}`);
          }
        }

        const memoryBlock = formatMemoryBlock(injectedNodes);
        if (!memoryBlock) return;
        for (const r of injectedNodes) {
          if (r.node?.id) {
            seen.add(r.node.id);
            pending.set(r.node.id, { label: r.node.label ?? r.node.id, turn });
          }
        }
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
        const postRerankIds = injectedNodes.map(r => r.node?.id).filter((id): id is string => id !== undefined);

        store.logInjectionMetrics(currentSessionId.value, {
          injectedNodeCount: injectedNodes.length,
          // Measure what was actually injected (the truncated memory block),
          // not full node content — the old formula overstated cost ~10x.
          injectedTokens: memoryBlock.length / 4,
          injectionMode: "messages_transform",
          queryText: userText.slice(0, 2000),
          injectedNodeTypes: nodeTypes,
          injectedContent,
          // Dream-RSI replay scores overlap against these — without them every
          // messages_transform row scored exactly 0.2 (overlap forced to 0).
          postRerankIds,
          rerankStrategy: appliedStrategy,
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
