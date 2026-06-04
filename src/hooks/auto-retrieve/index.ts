import type { MemoryNode, MemoryStore } from "../../storage/sqlite";
import { generateEmbedding } from "../../embeddings";
import { rerankDocuments } from "../../ollama";
import type { MemConfig } from "../../config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scoreCandidates } from "./scoring";
import { detectRelevantSkills, detectRelevantPlaybooks } from "./detection";
import { formatPlaybooksAsAvailable, formatSkillsAsAvailable } from "./formatting";
import { formatNodeForInjection } from "./content";

const INJECTION_LOG_DIR = path.join(os.homedir(), ".config", "opencode", "logs");
const INJECTION_LOG_FILE = path.join(INJECTION_LOG_DIR, "memory-injection.log");
const INJECTION_LOG_MAX_SIZE = 1024 * 1024;

try { fs.mkdirSync(INJECTION_LOG_DIR, { recursive: true }); } catch {}

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

export function createAutoRetrieveHook(deps: AutoRetrieveDeps): Record<string, MessagesHook> {
  const { store, config, log } = deps;

  const autoConfig = config.autoRetrieve;
  const ollamaConfig = config.ollama;

  const recentToolNames: string[] = [];

  log("info", "Auto-retrieve hook created", { enabled: autoConfig?.enabled, ollamaEnabled: ollamaConfig?.enabled });

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
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
            const MAX_TOKENS_PER_NODE = 300;
            const pendingJson = pendingNodes.map(n => formatNodeForInjection(n, MAX_TOKENS_PER_NODE));
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

        if (!userText || userText.length < 3) {
          log("debug", "User message too short", { length: userText?.length });
          return;
        }

        log("info", "Auto-retrieving for query", { query: userText.slice(0, 50) + "..." });

        const queryEmbedding = await generateEmbedding(userText);

        const maxPlaybooks = autoConfig.maxInjectPlaybooks ?? 3;
        const [candidates, relevantSkills, relevantPlaybooks] = await Promise.all([
          store.searchByEmbedding(queryEmbedding, autoConfig.candidateCount ?? 30, { bm25Weight: 0.4 }),
          detectRelevantSkills(store, userText, queryEmbedding, 3, log),
          detectRelevantPlaybooks(store, queryEmbedding, maxPlaybooks, log),
        ]);

        if (candidates.length === 0 && relevantSkills.length === 0 && relevantPlaybooks.length === 0) {
          log("debug", "No candidates, skills, or playbooks found");
          return;
        }

        const filtered = candidates.filter(c =>
          !c.label?.startsWith("rule:") && c.type !== "skill"
        );

        if (filtered.length === 0 && relevantSkills.length === 0 && relevantPlaybooks.length === 0) {
          log("debug", "No candidates after dedup");
          return;
        }

        log("debug", "Candidates after dedup", { count: filtered.length, skills: relevantSkills.length, playbooks: relevantPlaybooks.length });

        let scored = filtered.length > 0 ? scoreCandidates(filtered, userText, queryEmbedding) : [];

        if (ollamaConfig?.enabled && scored.length > 0) {
          log("info", "Ollama reranking", { model: ollamaConfig.model, candidateCount: scored.length });
          const startTime = Date.now();
          const results = await rerankDocuments(
            userText,
            scored.map(c => ({ id: c.id, label: c.label ?? c.id, content: c.content })),
            {
              baseUrl: ollamaConfig.baseUrl,
              model: ollamaConfig.model,
              topK: autoConfig.maxInjectNodes ?? 5,
            }
          );
          const ollamaDuration = Date.now() - startTime;

          const selectedIds = new Set(results.map(r => r.id));
          scored = scored.filter(c => selectedIds.has(c.id));
          log("info", "Ollama reranking done", { selectedCount: scored.length, ollamaDuration });
        }

        const maxNodes = autoConfig.maxInjectNodes ?? 5;
        const maxMemoryNodes = Math.max(0, maxNodes - relevantSkills.length - relevantPlaybooks.length);
        scored = scored.slice(0, maxMemoryNodes);

        const MAX_TOKENS_PER_NODE = 150;

        const memoriesJson = scored.map(n => formatNodeForInjection(n, MAX_TOKENS_PER_NODE));

        let fullBlock = "";

        if (memoriesJson.length > 0) {
          fullBlock += `### Retrieved Context:
Use the following memories to inform your response. Do not repeat or summarize them.

${JSON.stringify(memoriesJson, null, 2)}
---`;
        }

        if (relevantSkills.length > 0) {
          const skillsBlock = formatSkillsAsAvailable(relevantSkills);
          if (skillsBlock) {
            fullBlock += `\n\n### Available Skills:\nThe following skills are relevant to your task. Load full instructions with:\nmemory_skill_load(name="skill-name")\n\n${skillsBlock}`;
          }
        }

        if (relevantPlaybooks.length > 0) {
          const playbooksBlock = formatPlaybooksAsAvailable(relevantPlaybooks);
          if (playbooksBlock) {
            fullBlock += `\n\n### Available Playbooks:\nThe following playbooks match your current task. Execute one with:\nmemory_playbook_execute playbook_id="<id>"\n\n${playbooksBlock}`;
          }
        }

        if (!fullBlock) return;

        const debugLine = `[${new Date().toISOString()}] Query: ${userText.slice(0, 100)}...\n${fullBlock}\n\n`;
        try {
          try {
            const stat = fs.statSync(INJECTION_LOG_FILE);
            if (stat.size > INJECTION_LOG_MAX_SIZE) {
              fs.renameSync(INJECTION_LOG_FILE, INJECTION_LOG_FILE + ".old");
            }
          } catch { }
          fs.appendFileSync(INJECTION_LOG_FILE, debugLine);
        } catch { /* silent fail */ }

        if (userMsg && userMsg.parts) {
          userMsg.parts.unshift({ type: "text", text: fullBlock + "\n\n" });
        }

        log("info", "Memory injected", { nodeCount: scored.length, skillCount: relevantSkills.length, playbookCount: relevantPlaybooks.length, queryLength: userText.length });
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
