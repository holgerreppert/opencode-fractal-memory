import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { MemoryGet, MemoryFetch, MemorySet } from "./core";
import { MemoryDrilldown, MemorySearch } from "./search";

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
    description: `PROJECT HUB — crystal-clear, fine-grained network of **project structure knowledge** (NOT generic memory). Each node is a precise, verified finding placed at its **correct position** in the hub network via parent_ids vectors.

WHAT LIVES HERE (crystal-clear, not fuzzy):
- Architecture decision + why (e.g. why SQLite vs Postgres, why Svelte 5 runes)
- Project structure discovery (what lives where, how layers connect: storage→application→plugin)
- Common mistakes & exact solution (error signature + fix file:line, verified)
- Convention / preference / pattern that future code MUST follow

FINE-GRAINED NETWORK — POSITION IS CENTRAL:
Finding the right node where to put a new node **is the core task**. The hub is a **positioned network**, not a flat list. Every node has a **precise position** via parent_ids vectors:
- Hub \`fact:opencode-fractal-memory-hub\` = L0 root (project router)
- Children \`arch:*\`, \`convention:*\`, \`decision:*\` = L1 structural map
- Leaves \`lesson:*\`, \`fix:*\`, \`knowledge:*\` = L2 situated under their L1 parent
Example: a Svelte brain-smoothing lesson belongs under \`arch:svelte-frontend\`, not directly under hub. A storage BM25 bug belongs under \`arch:storage-and-query-layers\`. **Wrong position = not found.**

MANDATORY BEFORE set:
1. \`project_hub(mode="search", query="<topic>")\` + \`project_hub(mode="network")\` to see current hub map
2. Pick the **most specific parent** that already describes the area (e.g. \`arch:svelte-frontend\` for Three/Skeleton, not hub root). Include it in parent_ids. Hub itself is always included as root ancestor.
3. If no specific parent exists, create it first (e.g. \`arch:new-area\` under hub), then place your node under it.

WHEN vs memory:
- Structural knowledge (decision, structure, mistake/solution, convention) → project_hub(mode="set")
- Episode/log/session trace → memory(mode="set", type="event")
- Question about structure/decision/error → project_hub(mode="search") FIRST, not memory_search

EVERY hub node MUST have: summary (1-2 lines, 150-220 chars, crystal-clear) + keywords (5-10 comma tokens, BM25×2) + parent_ids vector to correct parent (auto-adds hub root if omitted, but you MUST choose the fine-grained parent). Keep nodes lean, verified (file:line tags), sticky for hub/dot.

MODES:
  search — hub network only (hub types, parent_ids-boosted, summary+keywords lexical). Ex: project_hub(mode="search", query="svelte skeleton")
  get/fetch/drilldown — by label (arch:..., decision:..., lesson:...) or id. Ex: project_hub(mode="get", label="arch:svelte-frontend")
  set — create at correct position. Required: label (kebab, e.g. arch:..., decision:..., lesson:fix-...), content (what+why, crystal-clear), type (hub type), summary, keywords, parent_ids (most specific parent, not just hub). Ex: project_hub(mode="set", label="fix:bm25-keywords", content="...", type="fix", summary="BM25 now indexes keywords ×2", keywords="bm25,keywords,search,hub", parent_ids="arch:storage-and-query-layers,fact:opencode-fractal-memory-hub")
  network — hub digest (hub + positioned children, capped 1.5KB) — use to find correct parent position before set.

TIPS:
- search → network → pick parent → set with correct parent_ids. Wrong position buries the node.
- Hub digest is also injected as [memory-plugin:hub] system msg when enabled — but explicit network gives full map.
`,
    args: {
      mode: tool.schema.enum(["search", "get", "fetch", "set", "network", "drilldown"]).describe("Which hub operation"),
      scope: tool.schema.enum(["global", "project", "all"]).optional().describe("Scope, default project"),
      query: tool.schema.string().optional().describe("Search query for hub network (search mode)"),
      label: tool.schema.string().optional().describe("Label for get/fetch/set (e.g. decision:use-svelte, lesson:bug-2026-09-06)"),
      id: tool.schema.string().optional().describe("UUID for get"),
      content: tool.schema.string().optional().describe("Crystal-clear what+why for project structure (verified, file:line)"),
      type: tool.schema.string().optional().describe("Hub type: arch/fact/decision/lesson/fix/convention/knowledge/skill/playbook/dot/workflow — pick type that matches parent area"),
      summary: tool.schema.string().optional().describe("Crystal-clear 1-2 line summary 150-220 chars — BM25 1× (auto-generated if omitted but explicit + positioned is better)"),
      keywords: tool.schema.string().optional().describe("5-10 comma tokens for BM25 ×2 hub lexical search — must include parent area terms for positioning (auto-generated if omitted)"),
      parent_ids: tool.schema.string().optional().describe("CRITICAL — comma parent_ids to correct position in hub network (most specific parent, e.g. arch:svelte-frontend,fact:opencode-fractal-memory-hub) — auto-adds hub root if omitted but specific parent is mandatory for fine-grained placement"),
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
        const result = await (setter as any).execute({
          scope,
          label: args.label,
          content: args.content,
          type,
          summary: args.summary,
          keywords: (args as any).keywords,
          parent_ids: parentIdsStr || undefined,
          importance: args.importance,
        }, {});
        // Fine-grained positioning check — hub-only placement is discouraged
        const ids = parentIdsStr.split(",").map((s) => s.trim()).filter(Boolean);
        const onlyHub = ids.length === 1 && (ids[0] === HUB_LABEL || (ids[0] ?? "").includes("opencode-fractal-memory-hub"));
        if (onlyHub) {
          return result + `\n\n⚠ Position: placed directly under hub root. For fine-grained network, pick most specific parent via project_hub(search+network) (e.g. arch:svelte-frontend, arch:storage-and-query-layers) and relink via parent_ids — hub --parent_ids--> arch:* --parent_ids--> your node.`;
        }
        return result;
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
