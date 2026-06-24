import { tool } from "@opencode-ai/plugin";
import type { MemoryStore, MemoryNode } from "../storage/sqlite";
import { generateEmbedding, estimateTokens } from "../embeddings";
import { computeHybridScore, tokenize } from "../utils/hybridScore";

export function MemoryInject(store: MemoryStore) {
  const t = tool({
    description: "Inject relevant memories into the prompt using a token budget and cascading detail levels.",
    args: {
      query: tool.schema.string(),
      maxTokens: tool.schema.number().int().positive().optional(),
      includeConfidential: tool.schema.boolean().optional(),
      costWeight: tool.schema.number().positive().optional(),
      debug: tool.schema.boolean().optional(),
      fallbackMessage: tool.schema.string().optional(),
      maxNodes: tool.schema.number().int().positive().optional(),
      maxLevel: tool.schema.number().int().optional(),
      minConfidence: tool.schema.number().min(0).max(1).optional(),
      budgetMode: tool.schema.enum(["dynamic", "strict"]).optional(),
      projectName: tool.schema.string().optional().describe("Filter to a specific project (if omitted, searches both global and project scopes)"),
    },
    async execute(args) {
      const { query, maxTokens, includeConfidential, costWeight, debug, fallbackMessage, maxNodes, maxLevel, minConfidence, budgetMode, projectName } = args as {
        query: string;
        maxTokens?: number;
        includeConfidential?: boolean;
        costWeight?: number;
        debug?: boolean;
        fallbackMessage?: string;
        maxNodes?: number;
        maxLevel?: number;
        minConfidence?: number;
        budgetMode?: string;
        projectName?: string;
      };

      const embedding = await generateEmbedding(query);

      const candidates: MemoryNode[] = await store.searchByEmbedding(embedding, 100, {
        minLevel: 0,
        maxLevel: 4,
        projectName,
      });

      const filtered = candidates.filter((n) => {
        const confidential = (n as MemoryNode & { confidential?: boolean }).confidential;
        if (!includeConfidential && confidential) return false;
        if (maxLevel !== undefined && (n.level ?? 0) > maxLevel) return false;
        if (minConfidence !== undefined && (n.confidence ?? 0) < minConfidence) return false;
        return true;
      });

      const nodeTokenCounts = new Map<string, number>();
      for (const n of filtered) {
        const metaTokens = (n.metadata as { tokenCount?: number } | null)?.tokenCount;
        const count = metaTokens ?? estimateTokens(n.content);
        nodeTokenCounts.set(n.id, count);
      }

      const queryTerms = query ? tokenize(query) : [];
      const relevanceScores = filtered.map((node) =>
        computeHybridScore(node, embedding, queryTerms)
      );

      const candidatesWithScore = filtered.map((node, i) => ({
        node,
        relevance: relevanceScores[i],
        tokens: nodeTokenCounts.get(node.id) ?? 0,
        score: (relevanceScores[i] ?? 0) - ((costWeight ?? 0) * (nodeTokenCounts.get(node.id) ?? 0)),
      }));
      candidatesWithScore.sort((a, b) => b.score - a.score);

      let selectedNodes: typeof filtered = [];
      let usedTokens = 0;
      const budget = maxTokens ?? 8000;
      for (const cand of candidatesWithScore) {
        if (usedTokens + cand.tokens > budget) continue;
        selectedNodes.push(cand.node);
        usedTokens += cand.tokens;
      }
      if (maxNodes !== undefined && selectedNodes.length > maxNodes) {
        selectedNodes = selectedNodes.slice(0, maxNodes);
        usedTokens = selectedNodes.reduce((sum, n) => sum + (nodeTokenCounts.get(n.id) ?? 0), 0);
      }

      // Render selected nodes as XML-like blocks
      const renderedNodes = selectedNodes.map(node => {
        const content = node.content
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
        return `<node label="${node.label ?? node.id}">\n${content}\n</node>`;
      }).join("\n\n");

      const finalXml = selectedNodes.length > 0
        ? `<memory_nodes>\n${renderedNodes}\n</memory_nodes>`
        : (fallbackMessage ?? "<fallback>No relevant memories fit the token budget.</fallback>");

      const finalTokens = estimateTokens(finalXml);

      if (debug) {
        const debugInfo = {
          budget,
          usedTokens,
          selectedCount: selectedNodes.length,
          candidates: candidatesWithScore.map(c => ({ id: c.node.id, score: c.score, tokens: c.tokens })),
        };
        return `<debug>${JSON.stringify(debugInfo)}</debug>\n\n${finalXml}\n\n---\nToken count: ${finalTokens}`;
      }

      const pricePerThousand = 0.00015;
      const costUsd = (finalTokens / 1000) * pricePerThousand;

      return `${finalXml}\n\n---\nToken count: ${finalTokens}\nEstimated cost: $${costUsd.toFixed(6)}`;
    },
  });
  return t;
}
