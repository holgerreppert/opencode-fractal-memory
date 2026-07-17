import { fallbackScore, llmJudgeScore } from "./scoring";
import { rerankDocuments } from "../../infrastructure/llm/ollama";
import type { MemConfig } from "../../infrastructure/config/config";
import type { MemoryStore, MemoryScope } from "../../storage/sqlite";

import { computeGate } from "../gate";
import { selectMMR } from "../mmr";
import { rewriteQuery } from "../query-refinement";

interface Part {
  type: string;
  text?: string;
  name?: string;
  isError?: boolean;
  input?: Record<string, unknown>;
}

interface Message {
  info: { role: string; synthetic?: boolean };
  parts: Part[];
}

type MessagesHook = (input: unknown, output: { messages: Message[] }) => Promise<void>;

export interface AutoRetrieveDeps {
  store: MemoryStore;
  config: MemConfig;
  client?: unknown;
  currentSessionId?: { value: string } | undefined;
  log: (level: "debug" | "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
}

const MEMORY_SEARCH_HEADER = /^### \[L(\d+)\](?: \[[^\]]+\])?\s+(.+?)\s*-\s*(\d+)%/;

export function createAutoRetrieveHook(deps: AutoRetrieveDeps): Record<string, MessagesHook> {
  const { store, config, client, currentSessionId, log } = deps;
  const ollamaConfig = config.ollama;

  if (!config.autoRetrieve?.enabled) {
    return {};
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const pipelineStart = Date.now();
      const messages = output.messages;
      if (!messages || messages.length === 0) return;

      let memoryResultPart: Part | null = null;
      let resultMsgIdx = -1;
      let partIdx = -1;

      for (let mi = 0; mi < messages.length; mi++) {
        const msg = messages[mi];
        if (!msg?.parts) continue;
        for (let pi = 0; pi < msg.parts.length; pi++) {
          const part = msg.parts[pi];
          if (part && part.type === "tool_result" && part.name === "memory_search") {
            memoryResultPart = part;
            resultMsgIdx = mi;
            partIdx = pi;
            break;
          }
        }
        if (memoryResultPart) break;
      }

      if (!memoryResultPart || !memoryResultPart.text) return;

      const agentReasoning = extractLastAgentReasoning(messages);
      if (!agentReasoning) {
        log("debug", "memory-rerank: No agent reasoning found for judge context");
        return;
      }

      log("info", "memory-rerank: Reranking memory_search results", {
        resultLength: memoryResultPart.text.length,
        contextLength: agentReasoning.length,
        ollamaEnabled: ollamaConfig?.enabled,
      });

      try {
        const candidates = await parseCandidates(memoryResultPart.text, store);
        if (candidates.length < 2) {
          log("debug", "memory-rerank: Not enough candidates to rerank", { count: candidates.length });
          return;
        }

        let ordered: Array<{ id: string; label: string; content: string; score: number; type: string | null; level: number }>;

        if (ollamaConfig?.enabled) {
          log("info", "memory-rerank: Sending to Ollama for reranking", {
            model: ollamaConfig.model,
            candidateCount: candidates.length,
            strategy: ollamaConfig.strategy ?? "llm",
          });

          const ollamaInput = candidates.map(c => ({ id: c.id, label: c.label, content: c.content }));
          const reranked = await rerankDocuments(agentReasoning, ollamaInput, {
            baseUrl: ollamaConfig.baseUrl,
            model: ollamaConfig.model,
            topK: candidates.length,
            strategy: ollamaConfig.strategy ?? "llm",
          });

          const rerankedIds = reranked.results.map(r => r.id);
          const idMap = new Map(candidates.map(c => [c.id, c]));
          const idScore = new Map(reranked.results.map(r => [r.id, r.score]));

          ordered = rerankedIds
            .map(id => {
              const c = idMap.get(id);
              return c ? { id: c.id, label: c.label, content: c.content, score: idScore.get(id) ?? 0, type: c.type ?? null, level: c.level ?? 0 } : null;
            })
            .filter(Boolean) as typeof ordered;

          log("info", "memory-rerank: Ollama reranking complete", {
            originalCount: candidates.length,
            rerankedCount: ordered.length,
          });
        } else if (config.autoRetrieve?.llmJudgeEnabled !== false && client && currentSessionId?.value) {
          log("info", "memory-rerank: Using LLM judge via SDK prompt", {
            candidateCount: candidates.length,
            sessionId: currentSessionId.value,
          });
          const scored = await llmJudgeScore(client, currentSessionId.value, agentReasoning, candidates);
          const cMap = new Map(candidates.map(c => [c.id, c]));
          ordered = scored.map(s => ({ ...s, type: cMap.get(s.id)?.type ?? null, level: cMap.get(s.id)?.level ?? 0 })) as typeof ordered;
        } else {
          log("info", "memory-rerank: No LLM client available, using fallback scoring");
          const scored = fallbackScore(candidates, agentReasoning);
          const cMap = new Map(candidates.map(c => [c.id, c]));
          ordered = scored.map(s => ({ ...s, type: cMap.get(s.id)?.type ?? null, level: cMap.get(s.id)?.level ?? 0 })) as typeof ordered;
        }

        if (ordered.length === 0) return;

        // Build a map from ordered items back to full candidate data
        const candidateMap = new Map(candidates.map(c => [c.id, c]));

        // 1. Injection Gate
        const gateResult = computeGate(ordered.map(item => ({
          id: item.id,
          label: item.label,
          content: item.content,
          score: item.score,
          type: candidateMap.get(item.id)?.type,
          level: candidateMap.get(item.id)?.level,
        })));

        log("info", "memory-rerank: Gate result", {
          totalCandidates: ordered.length,
          selected: gateResult.selected.length,
          uncertain: gateResult.uncertain,
          gated: gateResult.gated,
        });

        let finalItems = gateResult.selected;

        // 2. Query Refinement (if gate says uncertain)
        if (gateResult.uncertain && client && currentSessionId?.value) {
          log("info", "memory-rerank: Gate uncertain, attempting query refinement");

          const originalQuery = extractLastAgentQuery(messages) ?? agentReasoning.slice(0, 200);
          const rewritten = await rewriteQuery(client, currentSessionId.value, {
            originalQuery,
            reasoningContext: agentReasoning,
            topLabels: ordered.slice(0, 3).map(i => i.label),
            topScores: ordered.slice(0, 3).map(i => i.score),
          });

          if (rewritten) {
            log("info", "memory-rerank: Rewrote query", { original: originalQuery.slice(0, 80), rewritten });

            // Re-search with rewritten query via text/FTS5 (no embedding needed)
            const newResults = await store.searchText("all" as MemoryScope, rewritten, 30);

            if (newResults.length >= 2) {
              const newCandidates = newResults.map(n => ({
                id: n.id,
                label: n.label ?? "",
                content: n.content ?? "",
                importance: n.importance,
                confidence: n.confidence ?? 0.5,
                usefulnessScore: n.usefulnessScore ?? 0,
                accessCount: n.accessCount ?? 0,
                updatedAt: n.updatedAt,
                type: n.type,
                level: n.level,
              }));

              // Re-rerank with the same method
              let newOrdered: typeof ordered;
              if (ollamaConfig?.enabled) {
                const ollamaInput = newCandidates.map(c => ({ id: c.id, label: c.label, content: c.content }));
                const reranked = await rerankDocuments(agentReasoning, ollamaInput, {
                  baseUrl: ollamaConfig.baseUrl,
                  model: ollamaConfig.model,
                  topK: newCandidates.length,
                  strategy: ollamaConfig.strategy ?? "llm",
                });
                const idMap = new Map(newCandidates.map(c => [c.id, c]));
                const idScore = new Map(reranked.results.map(r => [r.id, r.score]));
                newOrdered = reranked.results
                  .map(r => {
                    const c = idMap.get(r.id);
                    return c ? { id: c.id, label: c.label, content: c.content, score: idScore.get(r.id) ?? 0, type: c.type, level: c.level } : null;
                  })
                  .filter(Boolean) as typeof ordered;
              } else if (client && currentSessionId?.value) {
                const scored = await llmJudgeScore(client, currentSessionId.value, agentReasoning, newCandidates);
                const cMap2 = new Map(newCandidates.map(c => [c.id, c]));
                newOrdered = scored.map(s => ({ ...s, type: cMap2.get(s.id)?.type ?? null, level: cMap2.get(s.id)?.level ?? 0 })) as typeof ordered;
              } else {
                const scored = fallbackScore(newCandidates, agentReasoning);
                const cMap2 = new Map(newCandidates.map(c => [c.id, c]));
                newOrdered = scored.map(s => ({ ...s, type: cMap2.get(s.id)?.type ?? null, level: cMap2.get(s.id)?.level ?? 0 })) as typeof ordered;
              }

              // Re-apply gate on refined results
              const refinedGate = computeGate(newOrdered.map(item => ({
                id: item.id,
                label: item.label,
                content: item.content,
                score: item.score,
                type: newCandidates.find(c => c.id === item.id)?.type,
                level: newCandidates.find(c => c.id === item.id)?.level,
              })));

              if (!refinedGate.gated) {
                log("info", "memory-rerank: Refinement improved results", {
                  before: gateResult.selected.length,
                  after: refinedGate.selected.length,
                });
                finalItems = refinedGate.selected;
                ordered = newOrdered.map(item => {
                  const nc = newCandidates.find(c => c.id === item.id);
                  return { id: item.id, label: item.label, content: item.content, score: item.score, type: nc?.type as string | null ?? null, level: nc?.level ?? 0 };
                });
              } else {
                log("info", "memory-rerank: Refinement still below threshold, keeping original results");
              }
            }
          }
        }

        if (finalItems.length === 0) {
          log("info", "memory-rerank: Gate blocked injection — all candidates below threshold");
          return;
        }

        // 3. MMR Selection (diversity-aware subset)
        const maxInject = config.autoRetrieve?.maxInjectNodes ?? 5;
        let mmrItems = finalItems;

        if (finalItems.length > maxInject) {
          // Batch-fetch embeddings for MMR diversity
          const embeddings = new Map<string, number[]>();
          const fetchPromises = finalItems.slice(0, 20).map(async (item) => {
            if (embeddings.has(item.id)) return;
            const node = await store.getNode(item.id).catch(() => null);
            if (node?.embedding) embeddings.set(item.id, node.embedding);
          });
          await Promise.all(fetchPromises);

          mmrItems = selectMMR(finalItems, embeddings, maxInject);

          log("info", "memory-rerank: MMR selected", {
            before: finalItems.length,
            after: mmrItems.length,
          });
        }

        // Log injection metrics
        const nodeTypes: Record<string, number> = {};
        for (const item of mmrItems) {
          const t = item.type ?? "unknown";
          nodeTypes[t] = (nodeTypes[t] ?? 0) + 1;
        }
        try {
          const preIds = candidates.map(c => c.id);
          const postIds = mmrItems.map(i => i.id);
          const scores = mmrItems.map(i => i.score);
          const strategy = ollamaConfig?.enabled ? (ollamaConfig.strategy ?? "ollama")
            : config.autoRetrieve?.llmJudgeEnabled !== false && client && currentSessionId?.value ? "llm_judge"
            : "fallback";
          const queryText = extractLastAgentQuery(messages);

          await store.logInjectionMetrics(currentSessionId?.value ?? "unknown", {
            injectedNodeCount: mmrItems.length,
            injectedTokens: mmrItems.reduce((s, i) => s + (i.content.length / 4), 0),
            injectionMode: "auto_retrieve",
            queryText: queryText ?? "",
            preRerankIds: preIds,
            postRerankIds: postIds,
            rerankScores: scores,
            rerankStrategy: strategy,
            rerankDurationMs: Date.now() - pipelineStart,
            injectedNodeTypes: nodeTypes,
          });
        } catch {
          // best-effort
        }

        // 4. Format results
        const originalLines = memoryResultPart.text.split("\n");
        const footerLines: string[] = [];
        let inFooter = false;
        for (const line of originalLines) {
          if (line.startsWith("Use memory_drilldown(") || line.startsWith("Use memory_temporal_edges(") || line.startsWith("**Self-Reflection**:") || line.startsWith("  `memory_rate")) {
            inFooter = true;
          }
          if (inFooter) {
            footerLines.push(line);
          }
        }

        const gateNote = gateResult.uncertain ? `\n*Gate: uncertain (score gap < ${(0.15 * 100).toFixed(0)}% between top results), showing top candidates only*\n` : "";
        const resultLines: string[] = [
          `## Reranked Memory Results (${mmrItems.length} matches)`,
          gateNote,
        ];

        for (const item of mmrItems) {
          const scorePct = (item.score * 100).toFixed(0);
          resultLines.push(`### ${item.label} — ${scorePct}% relevance`);
          resultLines.push(item.content.slice(0, 300) + (item.content.length > 300 ? "..." : ""));
          resultLines.push("");
        }

        if (footerLines.length > 0) {
          resultLines.push(...footerLines);
        }

        messages[resultMsgIdx]!.parts[partIdx] = {
          ...memoryResultPart,
          text: resultLines.join("\n"),
        };
      } catch (err) {
        log("warn", "memory-rerank: Reranking failed", {
          error: String(err),
        });
      }
    },
  };
}

function extractLastAgentQuery(messages: Message[]): string | null {
  for (let i = messages.length - 2; i >= 0; i--) {
    const msg = messages[i];
    if (!msg?.parts) continue;
    for (const part of msg.parts) {
      if (part.type === "tool_use" && part.name === "memory_search" && part.input) {
        const input = part.input as Record<string, unknown>;
        return typeof input.query === "string" ? input.query : null;
      }
    }
  }
  return null;
}

function extractLastAgentReasoning(messages: Message[]): string {
  for (let i = messages.length - 2; i >= 0; i--) {
    const msg = messages[i];
    if (!msg?.parts || msg.info?.role !== "assistant") continue;
    const texts: string[] = [];
    for (const part of msg.parts) {
      if (part.type === "reasoning" && part.text) {
        texts.push(part.text);
      }
    }
    if (texts.length > 0) return texts.join("\n").trim();
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        texts.push(part.text);
      }
    }
    const combined = texts.join("\n").trim();
    if (combined) return combined;
  }
  return "";
}

async function parseCandidates(
  text: string,
  store: MemoryStore,
): Promise<Array<import("./scoring").Candidate>> {
  const labels: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const m = line.match(MEMORY_SEARCH_HEADER);
    if (m) {
      const label = m[2]!.trim();
      if (label) labels.push(label);
    }
  }

  if (labels.length === 0) return [];

  const results: Array<import("./scoring").Candidate> = [];
  const scopes: MemoryScope[] = ["global", "project"];

  for (const label of labels) {
    let found = false;
    for (const scope of scopes) {
      const node = await store.getNodeByLabel(scope, label).catch(() => null);
      if (!node) continue;
      results.push({
        id: node.id,
        label: node.label ?? label,
        content: node.content ?? "",
        importance: node.importance,
        confidence: node.confidence,
        usefulnessScore: node.usefulnessScore,
        accessCount: node.accessCount,
        updatedAt: node.updatedAt,
        type: node.type,
        level: node.level,
      });
      found = true;
      break;
    }
    if (!found) {
      results.push({
        id: label,
        label,
        content: "",
        importance: 0.5,
        confidence: 0.5,
        usefulnessScore: 0.5,
        accessCount: 0,
        updatedAt: null,
      });
    }
  }

  return results;
}
