import type { MemoryStore } from "../storage/sqlite";
import type { ToolDefinition } from "@opencode-ai/plugin";
import * as tools from "../tools";
import { MemoryPlaybookExecute } from "../tools/playbook";
import { createGraphPluginTool } from "../tools/graph";

export function createToolMap(
  store: MemoryStore,
  journalTools: Record<string, ToolDefinition>,
  client: unknown,
) {
  return {
    memory_list: tools.MemoryList(store),
    memory_set: tools.MemorySet(store),
    memory_rate: tools.MemoryRate(store),
    memory_get: tools.MemoryGet(store),
    memory_fetch: tools.MemoryFetch(store),
    memory_replace: tools.MemoryReplace(store),
    memory_delete: tools.MemoryDelete(store),
    memory_verify: tools.MemoryVerify(store),
    memory_prune: tools.MemoryPrune(store),
    memory_compress: tools.MemoryCompress(store),
    memory_extract_patterns: tools.MemoryExtractPatterns(store),
    memory_summarize: tools.MemorySummarize(store),
    memory_llm_compress: tools.MemoryLlmCompress(store, client),
    memory_stats: tools.MemoryStats(store),
    memory_drilldown: tools.MemoryDrilldown(store),
    memory_search: tools.MemorySearch(store),
    memory_drilldown_query: tools.MemoryDrilldownQuery(store),
    memory_detect_topics: tools.MemoryDetectTopics(store),
    memory_generate_embeddings: tools.MemoryGenerateEmbeddings(store),
    memory_check_context: tools.MemoryCheckContext(store),
    memory_injection_stats: tools.MemoryInjectionStats(store),
    memory_injection_feedback: tools.MemoryInjectionFeedback(store),
    memory_tool_stats: tools.MemoryToolStats(store),
    memory_session_stats: tools.MemorySessionStats(store),
    memory_total_tokens: tools.MemoryTotalTokens(store, client),
    memory_reflect: tools.MemoryReflect(store, client),
    memory_distill: tools.MemoryDistill(store, client),
    memory_inject: tools.MemoryInject(store),
    memory_injection_debug: tools.MemoryInjectionDebug(store),
    memory_middle_term: tools.MemoryMiddleTerm(store),
    memory_dashboard: tools.MemoryDashboard(store),
    memory_cache_status: tools.MemoryCacheStatus(store),
    memory_help: tools.MemoryHelp(store),
    memory_version: tools.MemoryVersion(store),
    memory_auto_test: tools.createMemoryAutoTest(store),
    memory_playbook_execute: MemoryPlaybookExecute(store),
    memory_skill_load: tools.MemorySkillLoad(store),
    skill: tools.MemorySkillLoad(store),
    memory_temporal_edges: tools.MemoryTemporalEdges(store),
    memory_recall_context: tools.MemoryRecallContext(store),
    graph: createGraphPluginTool(),
    ...journalTools,
  };
}
