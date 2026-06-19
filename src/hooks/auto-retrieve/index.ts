import type { MemoryNode, MemoryStore } from "../../storage/sqlite";
import { generateEmbedding } from "../../embeddings";
import { rerankDocuments, chat } from "../../ollama";
import type { MemConfig } from "../../config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scoreCandidates } from "./scoring";
import { detectRelevantSkills, detectRelevantPlaybooks, type PlaybookInfo } from "./detection";

import { formatNodeForInjection } from "./content";
import { appendSessionLog } from "../../logging";
import type { MemoryScope } from "../../storage/sqlite";

const INJECTION_LOG_DIR = path.join(os.homedir(), ".config", "opencode", "logs");
const INJECTION_LOG_FILE = path.join(INJECTION_LOG_DIR, "memory-injection.log");
const INJECTION_LOG_MAX_SIZE = 1024 * 1024;

try { fs.mkdirSync(INJECTION_LOG_DIR, { recursive: true }); } catch {}

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function cleanUserQuery(text: string): string {
  let cleaned = text
    .replace(SYSTEM_REMINDER_RE, "")
    .replace(/<available_skills>[\s\S]*?<\/available_skills>/g, "")
    .replace(/<available_playbooks>[\s\S]*?<\/available_playbooks>/g, "")
    .replace(/^│.*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n")
    .trim();

  const firstLine = cleaned.split("\n")[0]?.trim() ?? "";
  if (firstLine.length >= 5) return firstLine;
  return cleaned.slice(0, 200);
}

const KEYWORD_CACHE_TTL_MS = 5 * 60 * 1000;

async function generateSearchKeywords(
  messages: Message[],
  ollamaConfig: MemConfig["ollama"] | undefined,
  cleanedUserText: string,
  cache: { keywords: string; timestamp: number } | null | undefined,
  log: (level: "debug" | "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void,
): Promise<{ keywords: string; usedLlm: boolean }> {
  // Use cached keywords if fresh
  if (cache && (Date.now() - cache.timestamp) < KEYWORD_CACHE_TTL_MS) {
    return { keywords: cache.keywords, usedLlm: false };
  }

  // Build conversation context from last few messages
  const contextLines: string[] = [];
  let count = 0;
  for (let i = messages.length - 1; i >= 0 && count < 6; i--) {
    const msg = messages[i];
    if (!msg || msg.info?.synthetic) continue;
    const role = msg.info?.role === "assistant" ? "Assistant" : "User";
    const text = msg.parts
      .filter(p => p.type === "text")
      .map(p => (p.text ?? "").slice(0, 200))
      .join(" ")
      .trim();
    if (!text) continue;
    contextLines.unshift(`${role}: ${text}`);
    count++;
  }
  const conversation = contextLines.join("\n");

  // Try LLM keyword generation
  if (ollamaConfig?.enabled) {
    try {
      const prompt = `You are a search query generator for a technical knowledge base.

Given the recent conversation, generate 3-5 search keywords that would find relevant technical documentation, code patterns, bug fixes, past decisions, and architecture notes.

Conversation:
${conversation}

Return ONLY comma-separated keywords. No explanation, no numbering.
Example: memory injection, cross-encoder scores, auto-retrieve query, onnx model`;

      const response = await chat([
        { role: "user", content: prompt },
      ], {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        temperature: 0.0,
      });

      const keywords = response
        .replace(/^["']|["']$/g, "")
        .trim();
      if (keywords.length >= 5) {
        log("info", "LLM generated search keywords", { keywords });
        return { keywords, usedLlm: true };
      }
    } catch (err) {
      log("warn", "LLM keyword generation failed, falling back to user text", { error: String(err) });
    }
  }

  return { keywords: cleanedUserText, usedLlm: false };
}

const SKILL_CACHE_TTL_MS = 5 * 60 * 1000;

interface SessionState {
  injectedNodeIds: Set<string>;
  lastQuery: string;
  lastQueryEmbedding: number[];
  lastInjectTime: number;
  skillsCache: { skills: MemoryNode[]; playbooks: PlaybookInfo[]; timestamp: number } | null;
  keywordCache: { keywords: string; timestamp: number } | null;
}

export interface AutoRetrieveDeps {
  store: MemoryStore;
  config: MemConfig;
  log: (level: "debug" | "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
}

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageInfo {
  role: string;
  synthetic?: boolean;
}

interface Message {
  info: MessageInfo;
  parts: MessagePart[];
}

type MessagesHook = (input: unknown, output: { messages: Message[] }) => Promise<void>;

async function resolveRerankIntent(store: MemoryStore): Promise<Record<string, number>> {
  const scopes: MemoryScope[] = ["global", "project"];
  const results = await Promise.all(scopes.map(s =>
    store.getNodeByLabel(s, "pref:rerank-intent").catch(() => null)
  ));
  const intentNode = results.find(n => n !== null);
  if (!intentNode) return {};
  const content = intentNode.content;
  const boostMatch = content.match(/boost:\s*(.+?)(?:\n|$)/);
  if (!boostMatch) return {};
  const boostEntries = boostMatch[1]!.split(",").map(s => s.trim()).filter(Boolean);
  const boosts: Record<string, number> = {};
  for (const entry of boostEntries) {
    const [type, weightStr] = entry.split("=").map(s => s.trim());
    if (type && weightStr) {
      const weight = parseFloat(weightStr);
      if (!isNaN(weight) && weight >= 0) {
        boosts[type] = weight;
      }
    }
  }
  return boosts;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

export function createAutoRetrieveHook(deps: AutoRetrieveDeps): Record<string, MessagesHook> {
  const { store, config, log } = deps;

  const autoConfig = config.autoRetrieve;
  const ollamaConfig = config.ollama;

  const sessionState = new Map<string, SessionState>();

  log("info", "Auto-retrieve hook created", { enabled: autoConfig?.enabled, ollamaEnabled: ollamaConfig?.enabled });

  function getSessionState(sessionId: string): SessionState {
    let state = sessionState.get(sessionId);
    if (!state) {
      state = {
        injectedNodeIds: new Set(),
        lastQuery: "",
        lastQueryEmbedding: [],
        lastInjectTime: 0,
        skillsCache: null,
        keywordCache: null,
      };
      sessionState.set(sessionId, state);
    }
    return state;
  }

  function appendInjectionLog(debugLine: string): void {
    try {
      try {
        const stat = fs.statSync(INJECTION_LOG_FILE);
        if (stat.size > INJECTION_LOG_MAX_SIZE) {
          fs.renameSync(INJECTION_LOG_FILE, INJECTION_LOG_FILE + ".old");
        }
      } catch { }
      fs.appendFileSync(INJECTION_LOG_FILE, debugLine);
    } catch { /* silent fail */ }
  }

  return {
    "experimental.chat.messages.transform": async (input, output) => {
      const inputRecord = input as Record<string, unknown>;
      const sessionId = typeof inputRecord.sessionID === "string" ? inputRecord.sessionID : "unknown";

      // Process pending injection queue first
      try {
        const pending = await store.getPendingInjections();
        if (pending.length > 0) {
          log("info", "Processing pending injections", { count: pending.length });

          const pendingNodes: MemoryNode[] = [];
          for (const p of pending) {
            try {
              const node = await store.getNode(p.nodeId);
              pendingNodes.push(node);
            } catch {
              log("warn", "Pending injection node not found", { nodeId: p.nodeId });
            }
          }

          if (pendingNodes.length > 0) {
            const PENDING_INJECTION_TOKENS = 300;
            const pendingJson = pendingNodes.map(n => formatNodeForInjection(n, PENDING_INJECTION_TOKENS));
            const pendingBlock = `\n\n### Injected Memory:\nThe following node was selected for injection from the management app.\n\n${JSON.stringify(pendingJson, null, 2)}---`;

            const lastUserIndex = findLastUserMessage(output.messages);
            if (lastUserIndex >= 0) {
              const userMsg = output.messages[lastUserIndex];
              if (userMsg && userMsg.parts) {
                userMsg.parts.unshift({ type: "text", text: pendingBlock + "\n\n" });
              }
            }
          }

          for (const p of pending) {
            await store.markInjectionProcessed(p.id);
          }
        }
      } catch (err) {
        log("error", "Pending injection processing failed", { error: String(err) });
      }

      if (!autoConfig?.enabled) {
        log("debug", "Auto-retrieve disabled in config");
        return;
      }

      try {
        const lastUserIndex = findLastUserMessage(output.messages);
        if (lastUserIndex === -1) {
          log("debug", "No user message found");
          return;
        }

        const userMsg = output.messages[lastUserIndex];
        if (!userMsg) {
          log("debug", "User message not found at index");
          return;
        }

        const userText = userMsg.parts
          .filter(p => p.type === "text")
          .map(p => p.text || "")
          .join(" ")
          .trim();

        if (!userText || userText.length < (autoConfig.minQueryLength ?? 10)) {
          log("debug", "User message too short, skipping auto-retrieve", { length: userText?.length });
          return;
        }

        const cleanedText = cleanUserQuery(userText);
        if (!cleanedText || cleanedText.length < 3) {
          log("debug", "Cleaned query too short, skipping", { originalLength: userText.length });
          return;
        }

        const state = getSessionState(sessionId);

        const { keywords: queryText, usedLlm } = await generateSearchKeywords(
          output.messages,
          ollamaConfig,
          cleanedText,
          state.keywordCache,
          log,
        );

        if (usedLlm && queryText !== cleanedText) {
          state.keywordCache = { keywords: queryText, timestamp: Date.now() };
        }

        // Rate limit: skip if last injection was too recent
        const cooldown = autoConfig.injectionCooldownMs ?? 30000;
        const timeSinceLastInject = Date.now() - state.lastInjectTime;
        if (timeSinceLastInject < cooldown) {
          log("debug", "Rate-limited, skipping auto-retrieve", { lastInject: timeSinceLastInject + "ms ago", cooldown });
          return;
        }

        const queryEmbedding = await generateEmbedding(queryText);

        // Query similarity check: if query is very similar to last, skip
        if (state.lastQuery && state.lastQueryEmbedding.length > 0) {
          const sim = cosineSimilarity(queryEmbedding, state.lastQueryEmbedding);
          if (sim > 0.95) {
            log("debug", "Query nearly identical to previous, skipping auto-retrieve", { similarity: sim.toFixed(3), lastQuery: state.lastQuery.slice(0, 30) });
            return;
          }
        }

        log("info", "Auto-retrieving for query", { raw: userText.slice(0, 30) + "...", cleaned: cleanedText, effective: queryText, llmGenerated: usedLlm });

        const maxPlaybooks = autoConfig.maxInjectPlaybooks ?? 3;

        // Skills/playbooks cache: re-use if cached < 5 min
        let relevantSkills: MemoryNode[] = [];
        let relevantPlaybooks: PlaybookInfo[] = [];
        if (state.skillsCache && (Date.now() - state.skillsCache.timestamp) < SKILL_CACHE_TTL_MS) {
          relevantSkills = state.skillsCache.skills;
          relevantPlaybooks = state.skillsCache.playbooks;
          log("debug", "Using cached skills/playbooks", { skills: relevantSkills.length, playbooks: relevantPlaybooks.length, cacheAge: ((Date.now() - state.skillsCache.timestamp) / 1000).toFixed(0) + "s" });
        } else {
          [relevantSkills, relevantPlaybooks] = await Promise.all([
            detectRelevantSkills(store, queryText, queryEmbedding, 3, log),
            detectRelevantPlaybooks(store, queryEmbedding, maxPlaybooks, log),
          ]);
          state.skillsCache = { skills: relevantSkills, playbooks: relevantPlaybooks, timestamp: Date.now() };
        }

        const [candidates] = await Promise.all([
          store.searchByEmbedding(queryEmbedding, autoConfig.candidateCount ?? 30, {
            bm25Weight: 0.4,
            maxLevel: 0,
            categoryFilter: "semantic",
          }),
        ]);

        if (candidates.length === 0 && relevantSkills.length === 0 && relevantPlaybooks.length === 0) {
          log("debug", "No candidates, skills, or playbooks found");
          return;
        }

        const filtered = candidates.filter(c =>
          !c.label?.startsWith("rule:") &&
          c.type !== "skill" &&
          c.type !== "storedcontext" &&
          (c.level ?? 0) === 0 &&
          c.category === "semantic" &&
          (c.scope === "global" || c.projectName === deps.store.projectName)
        );

        // Deduplicate against already-injected nodes in this session
        const uniqueFiltered = filtered.filter(c => !state.injectedNodeIds.has(c.id));
        log("debug", "Candidates after session dedup", { before: filtered.length, after: uniqueFiltered.length, alreadyInjected: state.injectedNodeIds.size });

        if (uniqueFiltered.length === 0 && relevantSkills.length === 0 && relevantPlaybooks.length === 0) {
          log("debug", "No unique candidates (all already injected)");
          return;
        }

        log("debug", "Candidates after dedup", { count: uniqueFiltered.length, skills: relevantSkills.length, playbooks: relevantPlaybooks.length });

        const typeBoosts = await resolveRerankIntent(store);
        if (Object.keys(typeBoosts).length > 0) {
          log("info", "Rerank intent boosts active", { typeBoosts });
        }
        let scored = uniqueFiltered.length > 0 ? scoreCandidates(uniqueFiltered, queryText, queryEmbedding, typeBoosts) : [];
        const preRerankIds = scored.map(c => c.id);

        let rerankResults: Array<{ id: string; score: number }> = [];
        let ollamaDuration = 0;

        if (ollamaConfig?.enabled && scored.length > 0) {
          log("info", "Ollama reranking", { model: ollamaConfig.model, candidateCount: scored.length });
          const startTime = Date.now();
          const output = await rerankDocuments(
            queryText,
            scored.map(c => ({ id: c.id, label: c.label ?? c.id, content: c.content })),
            {
              baseUrl: ollamaConfig.baseUrl,
              model: ollamaConfig.model,
              topK: autoConfig.maxInjectNodes ?? 5,
              strategy: ollamaConfig.strategy ?? "cross-encoder",
            }
          );
          ollamaDuration = Date.now() - startTime;
          rerankResults = output.results;
          const allScores = output.allScores;

          const selectedIds = new Set(rerankResults.map(r => r.id));
          scored = scored.filter(c => selectedIds.has(c.id));
          log("info", "Ollama reranking done", { selectedCount: scored.length, ollamaDuration, rerankScores: allScores.map(s => ({ id: s.id.slice(0, 12), score: s.score.toFixed(4) })) });
        }

        const maxNodes = autoConfig.maxInjectNodes ?? 5;
        const maxMemoryNodes = Math.max(0, maxNodes - relevantSkills.length - relevantPlaybooks.length);
        scored = scored.slice(0, maxMemoryNodes);

        // Build node type distribution for metrics
        const injectedNodeTypes: Record<string, number> = {};
        for (const n of scored) {
          const t = n.type ?? "unknown";
          injectedNodeTypes[t] = (injectedNodeTypes[t] ?? 0) + 1;
        }

        // Log injection metrics with full quality data
        try {
          const estimatedTokens = scored.length * 150 + relevantSkills.length * 50 + Object.keys(typeBoosts).length > 0 ? 0 : 0;
          await store.logInjectionMetrics(sessionId, {
            injectedNodeCount: scored.length,
            injectedTokens: estimatedTokens,
            injectionMode: "auto",
            queryText,
            preRerankIds,
            postRerankIds: scored.map(n => n.id),
            rerankScores: rerankResults.length > 0 ? rerankResults.map(r => r.score) : undefined,
            rerankStrategy: ollamaConfig?.enabled ? (ollamaConfig.strategy ?? "llm") : undefined,
            rerankDurationMs: ollamaDuration > 0 ? ollamaDuration : undefined,
            injectedNodeTypes,
            activeTypeBoosts: Object.keys(typeBoosts).length > 0 ? typeBoosts : undefined,
          });
        } catch (metricsErr) {
          log("warn", "Failed to log injection metrics", { error: String(metricsErr) });
        }

        // Track injected nodes for this session
        for (const n of scored) {
          state.injectedNodeIds.add(n.id);
        }
        for (const s of relevantSkills) {
          state.injectedNodeIds.add(s.id);
        }

        const AUTO_RETRIEVE_TOKENS = 150;
        const memoriesJson = scored.map(n => formatNodeForInjection(n, AUTO_RETRIEVE_TOKENS));

        let fullBlock = "";

        if (memoriesJson.length > 0) {
          fullBlock += `### Retrieved Context:\nUse the following memories to inform your response. Do not repeat or summarize them.\n\n${JSON.stringify(memoriesJson, null, 2)}\n---`;
        }

        if (relevantSkills.length > 0) {
          const skillNames = relevantSkills.map(s =>
            s.label?.replace(/^skill:/, "") ?? s.id.slice(0, 8)
          );
          fullBlock += `\n\n<!-- Relevant skills: ${skillNames.join(", ")}. If needed, run: memory_skill_load(name="<name>") -->`;
        }

        if (relevantPlaybooks.length > 0) {
          const playbookIds = relevantPlaybooks.map(p => p.label);
          fullBlock += `\n\n<!-- Relevant playbooks: ${playbookIds.join(", ")}. If needed, run: memory_playbook_execute(playbook_id="<id>") -->`;
        }

        if (!fullBlock) return;

        const debugLine = `[${new Date().toISOString()}] Query: ${userText.slice(0, 60)}... | cleaned: ${queryText}\n${fullBlock}\n\n`;
        appendInjectionLog(debugLine);

        if (deps.config?.sessionLog?.enabled) {
          appendSessionLog(`[${new Date().toISOString()}] AUTO RETRIEVE | id=${sessionId} | cleaned="${queryText}" | nodes=${scored.length} skills=${relevantSkills.length} playbooks=${relevantPlaybooks.length} | duration=${Date.now() - state.lastInjectTime}ms`);
        }

        if (userMsg && userMsg.parts) {
          userMsg.parts.unshift({ type: "text", text: fullBlock + "\n\n" });
        }

        state.lastQuery = queryText;
        state.lastQueryEmbedding = queryEmbedding;
        state.lastInjectTime = Date.now();

        log("info", "Memory injected", { nodeCount: scored.length, skillCount: relevantSkills.length, playbookCount: relevantPlaybooks.length, queryLength: queryText.length });
      } catch (err) {
        log("error", "Auto-retrieve failed", { error: String(err) });
      }
    },
  };
}

function findLastUserMessage(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.info?.role === "user" && !msg.info.synthetic) {
      return i;
    }
  }
  return -1;
}
