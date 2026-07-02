import { fallbackScore, llmJudgeScore } from "./scoring";
import { rerankDocuments } from "../../infrastructure/llm/ollama";
import type { MemConfig } from "../../infrastructure/config/config";
import type { MemoryStore, MemoryScope } from "../../storage/sqlite";

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
  currentSessionId?: { value: string };
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

        let ordered: Array<{ id: string; label: string; content: string; score: number }>;

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
              return c ? { id: c.id, label: c.label, content: c.content, score: idScore.get(id) ?? 0 } : null;
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
          ordered = await llmJudgeScore(client, currentSessionId.value, agentReasoning, candidates);
        } else {
          log("info", "memory-rerank: No LLM client available, using fallback scoring");
          ordered = fallbackScore(candidates, agentReasoning);
        }

        if (ordered.length === 0) return;

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

        const resultLines: string[] = [
          `## Reranked Memory Results (${ordered.length} matches)`,
          "",
        ];

        for (const item of ordered) {
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
