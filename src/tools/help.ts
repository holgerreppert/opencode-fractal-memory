import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { wrapWithTracking } from "./shared";

const COMMANDS = [
  { name: "memory_stats", desc: "Fractal memory statistics – nodes per level, compression ratios, tree structure" },
  { name: "memory_dashboard", desc: "Top nodes by access, type distribution, compression health, usefulness" },
  { name: "memory_list", desc: "List all memory nodes with content preview" },
  { name: "memory_search", desc: "Semantic / BM25 search over memory nodes (supports category_filter)" },
  { name: "memory_get", desc: "Get a single memory node by ID or label" },
  { name: "memory_fetch", desc: "Fetch a memory node by exact label (returns JSON)" },
  { name: "memory_set", desc: "Create or update a memory node" },
  { name: "memory_delete", desc: "Delete a memory node by ID or label" },
  { name: "memory_replace", desc: "Replace content within a memory node" },
  { name: "memory_drilldown", desc: "Fractal retrieval – walk from summary to source nodes" },
  { name: "memory_drilldown_query", desc: "Top-down drilldown by intent / query" },
  { name: "memory_compress", desc: "Compress nodes into level-up summaries" },
  { name: "memory_llm_compress", desc: "LLM-powered compression with richer summaries" },
  { name: "memory_extract_patterns", desc: "Extract cross-layer patterns across diverse topics" },
  { name: "memory_prune", desc: "Find and remove stale / unused nodes" },
  { name: "memory_verify", desc: "Verify node correctness and boost confidence" },
  { name: "memory_rate", desc: "Mark a node as helpful and adjust usefulness score" },
  { name: "memory_summarize", desc: "Generate an LLM prompt to summarize a node" },
  { name: "memory_check_context", desc: "Check token usage against context limit" },
  { name: "memory_total_tokens", desc: "Complete token analysis (memory + conversation)" },
  { name: "memory_injection_stats", desc: "Injection efficiency metrics" },
  { name: "memory_injection_feedback", desc: "Rate injected memory usefulness" },
  { name: "memory_tool_stats", desc: "Tool call statistics – durations, success rates" },
  { name: "memory_session_stats", desc: "Session forensics – tool sequence, files touched" },
  { name: "memory_reflect", desc: "Analyze a session and create lesson nodes" },
  { name: "memory_distill", desc: "Extract actionable rules from lesson nodes" },
  { name: "memory_inject", desc: "Inject relevant memories into the prompt" },
  { name: "memory_injection_debug", desc: "Show selected node IDs and token usage for last injection" },
  { name: "memory_middle_term", desc: "Retrieve middle-term context snapshots" },
  { name: "memory_version", desc: "Show installed plugin version" },
  { name: "memory_auto_test", desc: "Test auto-retrieval pipeline" },
  { name: "memory_detect_topics", desc: "Detect topic boundaries across nodes" },
  { name: "memory_generate_embeddings", desc: "Generate embeddings for nodes that lack them" },
  { name: "memory_cache_status", desc: "Show working-memory cache usage" },
  { name: "memory_help", desc: "Show this help message" },
  { name: "memory_temporal_edges", desc: "Retrieve temporal edges for a memory node (conversation flow)" },
];

export function MemoryHelp(store?: MemoryStore) {
  const t = tool({
    description: "Show all available memory commands and their descriptions.",
    args: {},
    async execute() {
      const lines: string[] = [
        "## Memory Plugin Commands",
        "",
        "```",
      ];

      for (const cmd of COMMANDS) {
        lines.push(`  ${cmd.name.padEnd(28)} ${cmd.desc}`);
      }

      lines.push("```", "", "### Memory Categories", "",
        "Nodes have a `category` (semantic / episodic) that controls retention:",
        "- **Semantic** – long-term facts (365d half-life): concept, fact, lesson, howto, decision, architecture, preference, convention, bug, fix, rule:*, skill, playbook, knowledge, research, core, summary",
        "- **Episodic** – session traces (7d half-life, 30d TTL): event, note, session, task, plan, exploration, debug-investigation, improvement, review",
        "",
        "Use `memory_search` with `category_filter` to target a specific category.",
        "Use `memory_set` with a semantic type for important facts that should persist.",
        "", "### About Fractal Memory", "");
      lines.push(
        "Fractal memory organizes knowledge as a hierarchy of increasingly compressed summaries:",
        "- **L0 (raw)** – Full content, no compression",
        "- **L1 (weekly)** – Weekly summaries of related L0 nodes",
        "- **L2 (monthly)** – Patterns extracted from L1 summaries",
        "- **L3 (quarterly)** – Cross-cutting themes from L2",
        "- **L4+ (yearly)** – Highest-level synthesis",
        "",
        "Use `memory_drilldown` to trace a summary back to its source nodes.",
        "Use `memory_compress` to promote nodes to the next level.",
        "Use `memory_search` with `min_level` / `max_level` to target specific compression levels.",
      );

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_help");
}
