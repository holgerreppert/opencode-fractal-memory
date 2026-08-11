import { rerankCandidates, rerankStrategyLabel, toGateInput, type RerankedItem } from "./rerankers";
import {
  findMemorySearchResult,
  extractLastAgentQuery,
  extractLastAgentReasoning,
  extractFooterLines,
  type MessagesHook,
} from "./messages";
import { parseCandidates } from "./candidates";
import type { MemConfig } from "../../infrastructure/config/config";
import type { MemoryStore } from "../../storage/sqlite";

import { computeGate } from "../gate";
import { selectMMR } from "../mmr";
import { rewriteQuery } from "../query-refinement";
import { injectionMarker, recordInjection } from "../injection-visibility";

export interface AutoRetrieveDeps {
  store: MemoryStore;
  config: MemConfig;
  client?: unknown;
  currentSessionId?: { value: string } | undefined;
  log: (level: "debug" | "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
}

export function createAutoRetrieveHook(deps: AutoRetrieveDeps): Record<string, MessagesHook> {
  const { store, config, client, currentSessionId, log } = deps;
  const ollamaConfig = config.ollama;
  const llmJudgeEnabled = config.autoRetrieve?.llmJudgeEnabled !== false;
  const rerankDeps = {
    client,
    currentSessionId,
    ollama: ollamaConfig,
    llmJudgeEnabled,
    log,
  };

  if (!config.autoRetrieve?.enabled) {
    return {};
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const pipelineStart = Date.now();
      const messages = output.messages;
      if (!messages || messages.length === 0) return;

      const memoryResult = findMemorySearchResult(messages);
      if (!memoryResult || !memoryResult.part.text) return;

      const agentReasoning = extractLastAgentReasoning(messages);
      if (!agentReasoning) {
        log("debug", "memory-rerank: No agent reasoning found for judge context");
        return;
      }

      log("info", "memory-rerank: Reranking memory_search results", {
        resultLength: memoryResult.part.text.length,
        contextLength: agentReasoning.length,
        ollamaEnabled: ollamaConfig?.enabled,
      });

      try {
        const candidates = await parseCandidates(memoryResult.part.text, store);
        if (candidates.length < 2) {
          log("debug", "memory-rerank: Not enough candidates to rerank", { count: candidates.length });
          return;
        }

        let ordered: RerankedItem[] = await rerankCandidates(rerankDeps, agentReasoning, candidates);

        if (ordered.length === 0) return;

        // Build a map from ordered items back to full candidate data
        const candidateMap = new Map(candidates.map(c => [c.id, c]));

        // 1. Injection Gate
        const gateResult = computeGate(toGateInput(ordered, candidateMap));

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

            // Re-search with rewritten query via BM25 (no embedding needed)
            const { searchNodes } = await import("../search");
            const { generateEmbedding } = await import("../../infrastructure/llm/embeddings");
            const newResults = await searchNodes(store, generateEmbedding, rewritten, {
              mode: "bm25",
              limit: 30,
            });

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
              const newOrdered = await rerankCandidates(rerankDeps, agentReasoning, newCandidates);
              const newCandidateMap = new Map(newCandidates.map(c => [c.id, c]));

              // Re-apply gate on refined results
              const refinedGate = computeGate(toGateInput(newOrdered, newCandidateMap));

              if (!refinedGate.gated) {
                log("info", "memory-rerank: Refinement improved results", {
                  before: gateResult.selected.length,
                  after: refinedGate.selected.length,
                });
                finalItems = refinedGate.selected;
                ordered = newOrdered.map(item => ({
                  id: item.id,
                  label: item.label,
                  content: item.content,
                  score: item.score,
                  type: newCandidateMap.get(item.id)?.type as string | null ?? null,
                  level: newCandidateMap.get(item.id)?.level ?? 0,
                }));
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
          const strategy = rerankStrategyLabel(rerankDeps);
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
            injectedContent: mmrItems.slice(0, 10).map(i => ({
              label: i.label,
              type: i.type ?? "unknown",
              snippet: i.content.slice(0, 300),
            })),
          });
        } catch {
          // best-effort
        }

        // 4. Format results
        const footerLines = extractFooterLines(memoryResult.part.text);

        const gateNote = gateResult.uncertain ? `\n*Gate: uncertain (score gap < ${(0.15 * 100).toFixed(0)}% between top results), showing top candidates only*\n` : "";
        const markerLine = injectionMarker(config, "auto-retrieve", `${mmrItems.length} reranked node(s)`);
        const resultLines: string[] = [
          ...(markerLine ? [markerLine, ""] : []),
          `## Reranked Memory Results (${mmrItems.length} matches)`,
          gateNote,
        ];

        const rerankStrategy = rerankStrategyLabel(rerankDeps);
        recordInjection(config, "auto-retrieve", `${mmrItems.length} node(s): ${mmrItems.map(i => i.label).join(", ")} (strategy=${rerankStrategy})`);

        for (const item of mmrItems) {
          const scorePct = (item.score * 100).toFixed(0);
          resultLines.push(`### ${item.label} — ${scorePct}% relevance`);
          resultLines.push(item.content.slice(0, 300) + (item.content.length > 300 ? "..." : ""));
          resultLines.push("");
        }

        if (footerLines.length > 0) {
          resultLines.push(...footerLines);
        }

        messages[memoryResult.msgIdx]!.parts[memoryResult.partIdx] = {
          ...memoryResult.part,
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
