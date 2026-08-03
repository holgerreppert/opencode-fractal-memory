import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { generateEmbedding } from "../infrastructure/llm/embeddings";
import { rerankDocuments } from "../infrastructure/llm/ollama";

export function createMemoryAutoTest(store: MemoryStore) {
  const testQuery = "JSON parsing and validation best practices";
  
  return tool({
    description: "Test auto-retrieval pipeline with a hardcoded query - used for debugging",
    args: {},
    async execute() {
      try {
        const queryEmbedding = await generateEmbedding(testQuery);
        const candidates = await store.searchByEmbedding(queryEmbedding, 10);
        
        if (candidates.length === 0) return "No candidates found";
        
        const results = await rerankDocuments(
          testQuery,
          candidates.map((c) => ({ id: c.id, label: c.label ?? c.id, content: c.content.slice(0, 200) })),
          { topK: 3, strategy: "cross-encoder" }
        );
        
        const selected = candidates.filter((c) => results.results.some((r: { id: string }) => r.id === c.id));
        
        return `Pipeline test: query="${testQuery}", candidates=${candidates.length}, selected=${selected.length}\n\nSelected:\n${selected.map((n, i) => `${i+1}. ${n.label}: ${n.content.slice(0, 100)}`).join("\n")}`;
      } catch (err) {
        return `Error: ${err}`;
      }
    },
  });
}