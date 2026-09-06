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
    description: `PROJECT HUB — crystallized tool for **crystal-clear project structure knowledge** as a **fine-grained positioned network**. Use it exactly as instructed — position is everything.

=== CRYSTALLIZED INSTRUCTIONS — FOLLOW EXACTLY ===

1. PURPOSE (crystal-clear, not fuzzy): Store ONLY project-structure knowledge:
   - Architecture decision + WHY (e.g. why SQLite vs Postgres, why Svelte 5 runes, why subprocess WASM)
   - Project structure discovery (what lives where, how layers connect: storage→application→plugin→management/Svelte)
   - Common mistakes & EXACT solution (error signature + fix file:line, verified)
   - Convention / preference / pattern that future code MUST follow
   → If it is not crystal-clear and positioned, it does NOT belong in hub (use memory event instead).

2. POSITION IS CENTRAL — FINDING THE RIGHT NODE IS THE CORE TASK:
   Hub is NOT a flat list. It is a **positioned network via parent_ids vectors**:
   - L0 \`fact:opencode-fractal-memory-hub\` = root router
   - L1 \`arch:*\`/\`convention:*\`/\`decision:*\` = structural map (e.g. arch:svelte-frontend, arch:storage-and-query-layers, convention:dev-install-and-cache)
   - L2 \`lesson:*\`/\`fix:*\`/\`knowledge:*\` = leaves situated under their L1 parent
   **Rule: New node belongs under its most specific parent, not hub root.**
   - Svelte brain-smoothing lesson → parent_ids="arch:svelte-frontend,fact:opencode-fractal-memory-hub" (WRONG if only hub)
   - BM25 keywords bug → parent_ids="arch:storage-and-query-layers,fact:..."
   Wrong position = not found, even with perfect keywords. Finding the right position is more important than the content itself.

3. MANDATORY 3-STEP BEFORE EVERY set:
   a) project_hub(mode="search", query="<your topic>")  — find related hub nodes
   b) project_hub(mode="network") — see current positioned map (hub + L1 + L2, capped 1.5KB)
   c) Pick the most specific parent from (a)+(b). If none exists, FIRST create it: project_hub(set, label="arch:new-area", parent_ids="fact:opencode-fractal-memory-hub", ...), THEN place your node under it.

4. WHEN vs memory — CHOOSE CORRECT TOOL:
   - Structural knowledge (decision, structure, mistake/solution, convention) → project_hub set
   - Episode/log/session trace → memory set type=event
   - Question about structure/decision/error → project_hub search FIRST (not memory_search)

5. EVERY hub node MUST be: crystal-clear (precise, verified file:line, no vague prose) + lean (1-2 line summary 150-220 chars, BM25 1×) + keywords (5-10 comma tokens, BM25×2, must include parent area terms) + correct parent_ids vector + file: tags. Sticky for hub/dot.

MODES:
  search — hub network only (parent_ids-boosted, summary+keywords lexical). Ex: project_hub(mode="search", query="svelte skeleton")
  get/fetch/drilldown — by label (arch:..., decision:..., lesson:...) or id. Ex: project_hub(mode="get", label="arch:svelte-frontend")
  set — create at correct position. Required: label (kebab, e.g. arch:..., decision:..., lesson:fix-...), content (crystal-clear what+why with file:line), type, summary, keywords, parent_ids (most specific parent, not just hub). Ex: project_hub(mode="set", label="fix:bm25-keywords", content="...", type="fix", summary="BM25 now indexes keywords ×2", keywords="bm25,keywords,search,hub", parent_ids="arch:storage-and-query-layers,fact:opencode-fractal-memory-hub")
  network — hub digest (hub + positioned children, capped 1.5KB) — use to find correct parent position before set. Injected as [memory-plugin:hub] when enabled, but explicit network gives full map.

TIPS: search → network → pick parent → set with correct parent_ids. If you skip step 3, the node will be buried and the tool will warn ⚠ only hub.
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
