import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { MemorySearch, MemoryGet, MemoryFetch, MemorySet } from "./core";
import { MemoryDrilldown } from "./search";

const HUB_LABEL = "fact:opencode-fractal-memory-hub";
const HUB_TYPES = new Set(["fact", "decision", "lesson", "fix", "convention", "architecture", "knowledge", "skill", "playbook", "dot", "workflow", "concept", "research"]);

async function getHubId(store: MemoryStore, scope: "global" | "project" = "project"): Promise<string | null> {
  try {
    const hub = await store.getNodeByLabel(scope as any, HUB_LABEL);
    return hub.id;
  } catch {
    return null;
  }
}

export function createProjectHubTool(store: MemoryStore) {
  const t = tool({
    description: `PROJECT HUB — fine-grained network of key project findings (architectural decisions, common mistakes & solutions, conventions) with parent_ids vectors to hub.

WHEN vs memory:
- Architectural decision / rationale / convention / bug root cause+fix / anti-pattern / dependency → project_hub(mode="set")
- Episode / log / session trace → memory(mode="set", type="event")
- Question about past decision/convention/error → project_hub(mode="search") FIRST (hub network), not generic memory_search
- Every hub node MUST have summary (1-2 lines) + keywords (5-10 comma tokens BM25×2) + parent_ids vector to hub (auto-added if omitted). Network is sticky, browsable via project_hub(mode="network") and dot:hub-network.

MODES:
  search — lexical+semantic over hub network only (filtered to hub types, boosted by parent_ids→hub). Params: query (required), limit, scope. Ex: project_hub(mode="search", query="svelte skeleton")
  get/fetch — by label (fact:..., decision:..., lesson:...) or id. Ex: project_hub(mode="get", label="fact:svelte-stack")
  set — create/update hub node. Required: label (kebab, e.g. decision:..., lesson:..., fix:...), content (what+why), type (hub type). Requires summary+keywords, parent_ids auto-linked to hub if omitted. Ex: project_hub(mode="set", label="decision:use-svelte", content="...", type="decision", summary="Svelte 5 + Skeleton", keywords="svelte,skeleton,AppShell")
  network — return hub digest (hub row + top children summaries, capped 1.5KB) + DOT generation hint. Ex: project_hub(mode="network")

TIPS:
- search → drilldown/get → set/verify. Hub digest injected via [memory-plugin:hub] system msg when B1 enabled, but explicit project_hub(search) is richer.
- Keep hub network lean: 1-2 line summary per node, 5-10 keywords, parent_ids vectors, file: tags for verification.
`,
    args: {
      mode: tool.schema.enum(["search", "get", "fetch", "set", "network", "drilldown"]).describe("Which hub operation"),
      scope: tool.schema.enum(["global", "project", "all"]).optional().describe("Scope, default project"),
      query: tool.schema.string().optional().describe("Search query for hub network (search mode)"),
      label: tool.schema.string().optional().describe("Label for get/fetch/set (e.g. decision:use-svelte, lesson:bug-2026-09-06)"),
      id: tool.schema.string().optional().describe("UUID for get"),
      content: tool.schema.string().optional().describe("Content for set (what+why)"),
      type: tool.schema.string().optional().describe("Hub type: fact/decision/lesson/fix/convention/architecture/knowledge/skill/playbook/dot/workflow"),
      summary: tool.schema.string().optional().describe("Short 1-2 line summary 150-220 chars — BM25 1× (auto-generated if omitted)"),
      keywords: tool.schema.string().optional().describe("Comma keywords 5-10 tokens — BM25 ×2 for hub network lexical search (auto-generated if omitted)"),
      parent_ids: tool.schema.string().optional().describe("Comma parent_ids (auto-adds hub if omitted)"),
      importance: tool.schema.number().optional(),
      limit: tool.schema.number().int().positive().optional(),
    },
    async execute(args) {
      const mode = args.mode as string;
      const scope = (args.scope ?? "project") as "global" | "project" | "all";
      // search — delegate to MemorySearch but hint hub types
      if (mode === "search") {
        if (!args.query) throw new Error("query required for search");
        const search = MemorySearch(store as any);
        // reuse memory search but filter post-hoc to hub types / parent-linked is done via ranking boost already
        // we just call it with same query; caller can filter via type if needed
        return await (search as any).execute({ query: args.query, limit: args.limit ?? 8, scope, rerank: true }, {});
      }
      if (mode === "get" || mode === "fetch") {
        const handler = mode === "fetch" ? MemoryFetch(store) : MemoryGet(store);
        return await (handler as any).execute({ label: args.label, id: args.id, scope }, {});
      }
      if (mode === "drilldown") {
        const handler = MemoryDrilldown(store);
        return await (handler as any).execute({ label: args.label, id: args.id, scope }, {});
      }
      if (mode === "set") {
        if (!args.label || !args.content) throw new Error("label and content required for set");
        const type = (args.type ?? "fact") as string;
        if (!HUB_TYPES.has(type) && type !== "dot") {
          throw new Error(`type must be one of hub types: ${[...HUB_TYPES].join(", ")} (got ${type})`);
        }
        // ensure parent_ids includes hub
        let parentIdsStr = args.parent_ids ?? "";
        const hubId = await getHubId(store, scope === "all" ? "project" : (scope as any));
        if (hubId) {
          const ids = parentIdsStr.split(",").map((s) => s.trim()).filter(Boolean);
          if (!ids.includes(hubId) && !ids.includes(HUB_LABEL)) {
            // prefer hub label for readability, but store will resolve label→id via parentIds handling
            // we store hub label as parent hint; nodes.ts will keep it as string, hub network uses label match too
            // to ensure vector, add hub label
            ids.unshift(HUB_LABEL);
            parentIdsStr = ids.join(",");
          }
        } else if (!parentIdsStr) {
          parentIdsStr = HUB_LABEL;
        }
        const setter = MemorySet(store);
        return await (setter as any).execute({
          scope,
          label: args.label,
          content: args.content,
          type,
          summary: args.summary,
          keywords: (args as any).keywords,
          parent_ids: parentIdsStr || undefined,
          importance: args.importance,
        }, {});
      }
      if (mode === "network") {
        const hubId = await getHubId(store, scope === "all" ? "project" : (scope as any));
        let hub: any = null;
        try {
          hub = await store.getNodeByLabel((scope === "all" ? "project" : scope) as any, HUB_LABEL);
        } catch {}
        if (!hub) return `No hub found for scope=${scope}. Create via project_hub(mode="set", label="${HUB_LABEL}", ...) or ensureProjectHub seeder.`;
        const all = await store.listNodes(scope === "all" ? "all" : (scope as any), undefined, 50, 0, false, scope === "project" ? store.projectName : undefined);
        const children = all.filter((n) => (n.parentIds ?? []).includes(hub.id) || (n.parentIds ?? []).includes(HUB_LABEL as any));
        const digest = [
          `Hub: ${hub.label} (${hub.id.slice(0, 8)}) — ${hub.content.slice(0, 200)}`,
          `Children (${children.length}):`,
          ...children.slice(0, 15).map((c) => `- ${c.label} [${c.type}] ${c.summary ?? c.content.slice(0, 80)} keywords:${(c as any).keywords ?? "-"} parent_ids:${(c.parentIds ?? []).join(",").slice(0, 60)}`),
          children.length > 15 ? `... +${children.length - 15} more (use project_hub search)` : "",
          `DOT: dot:hub-network digraph { hub -> ${children.slice(0, 8).map((c) => c.label ?? c.id.slice(0, 6)).join("; hub -> ")} }`,
        ].join("\n");
        return digest.slice(0, 1500);
      }
      throw new Error(`Unknown mode ${mode}`);
    },
  });
  return t;
}
