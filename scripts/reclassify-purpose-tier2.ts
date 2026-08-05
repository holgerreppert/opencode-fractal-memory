import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";

const DB_PATH = path.join(os.homedir(), ".config", "opencode", "memory.db");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// Tier 2: manual purpose classification of the 89 remaining null-type content
// nodes. Each entry is node id → purpose type, assigned by reading the node's
// content (see scripts/tier2-review). Categories follow store conventions:
// task/plan/event are episodic; everything else semantic.
const ID_TYPE: Record<string, string> = {
  // demo/test/example nodes
  "1a68b97a-78ea-4795-92be-152bfb41f3a4": "note",      // memory-demo
  "3aa47ea4-a8e8-450f-b9c2-d4fd65c4eb07": "note",      // test-memory-2026-04-17
  // system knowledge
  "e2fb9aaa-ccd9-4219-8c86-0c3806726043": "knowledge", // sqlite-storage
  "bed26d8d-2fdc-4530-afef-c49d8ff73f2b": "knowledge", // compression-strategies
  "20dab9fd-fa5e-4a4e-ac07-46b59ec85459": "knowledge", // embeddings
  "cbec5e51-15b3-4deb-994d-12894bbe22b0": "summary",   // summary-fractal
  "be4a2a3c-3c52-423a-a72c-1743ee63f689": "summary",   // fractal-memory-summary
  // research
  "db6aa578-1a34-400d-aa34-21973f6cc616": "research", // dj-rest-auth-research
  "2a8d3f6a-9055-4b53-a105-4b4e547cd2b6": "research", // langfuse-span-research
  "240e2551-76b8-4268-bad8-5ace5192dc20": "research", // memory-improvement-research-2026-04-19
  "f2916187-5729-4e31-8a73-27f3ab23b114": "research", // memory-injection-improvements-findings
  "75d2ee86-d5f2-482f-a5f9-2714548e6b50": "research", // LLM-as-judge implementation research
  "2014e588-a197-444c-99fb-1bde49dd9557": "research", // agent-skills-research
  "db420607-dc65-4e5a-9f69-e672424590b3": "research", // job-address-research-requirements
  "a370d347-3ed1-4919-95aa-4c28aeb74243": "research", // mittwald-deployment-research
  "ba6200b9-5940-438f-9565-4209bea181ce": "research", // benchmark:temporal-edges-v2-results
  // plans
  "85d17555-b78a-4689-be14-8a515ebe0488": "plan",     // document-categorization-plan
  "e45235ad-07a8-40fc-a79f-df872623a0c4": "plan",     // advisor-testing-plan
  "434ac8bd-7d99-4573-95af-12b4738477c0": "plan",     // advisor-structured-actions-plan
  "803f4b34-82a9-4e7a-86cf-c7502596c57a": "plan",     // Add volumes to remote Langfuse
  "a7d3ed58-a9c4-477b-8abc-196c0e7c75b3": "plan",     // django-postgres-migration
  "5a70851c-da62-41cf-95a6-2665f5206739": "plan",     // langchain-integration-plan
  "94ad4e2d-049a-4022-ae14-0acc83d9594c": "plan",     // backend-architecture-plan
  "40804aaa-2bff-458d-b813-8c8657eb10e7": "plan",     // phase-1-implementation-sketch
  "97347050-bb0c-4c4e-9b0b-3359108a8ea5": "plan",     // phase-2-implementation-sketch
  "e6a8487d-5e4d-4d49-98e5-1e28506a3cd2": "plan",     // phase-3-implementation-sketch
  "2a5ec96e-2b2f-425f-8087-dde2a16d0d50": "plan",     // backend-refactor-plan
  "7da0b312-e55a-4818-adeb-23e7275a09ab": "plan",     // backend_oop_improvement_plan
  "cfc588ed-9ce5-468e-9f76-7bee314237cf": "plan",     // plugin-optimization-plan
  "511dc4bc-2918-4ecc-9b9f-b499570800b1": "plan",     // improvement-plan-bugs-first
  // bugs / issues
  "a2d1307e-ba49-4ecb-9b35-9bef073f4e3c": "bug",      // skeleton-svelte Vite 8 compat
  "f5fdc4ee-1dbc-45f9-a4c1-f8ef581f07a1": "bug",      // vitest-double-svelte-plugin-bug
  "53cbac44-0acb-42f5-a4d5-abf3d2be623f": "bug",      // testing-library-svelte-dollar-conflict
  "1028c13f-12cb-464f-80e7-d201753e0cf8": "bug",      // deploy pip conflict packaging
  "c8a90422-1814-419c-a086-3fc414fd1a8e": "bug",      // opencode-glob-grep-hang-root-cause
  "5d15259a-8f7e-4734-b632-c0ac5af31ec2": "bug",      // langchain-reasoning-content-issue
  // fixes
  "07a42774-fbe5-447d-90c8-3bb08f69b556": "fix",      // advisor-mixing-fix-plan
  "d43a4886-034b-4b2a-bd19-749316078e67": "fix",      // vitest-browser-mode-fixes
  "651b2f35-a760-48b7-b443-01b519f6f03c": "fix",      // deploy script rclone mismatch
  "4ed1d18a-4b64-4e81-952d-57011b1b202f": "fix",      // redis auth fix mittwald
  "b7eba867-4587-485a-9be3-98eb3dbdaa6d": "fix",      // local-plugin-loading-fix
  "b45ff1b3-ad6b-487a-8386-51c174a5eabe": "fix",      // management-ui-search-scope-fixes
  // howtos / operational knowledge
  "816a85a2-e36a-4527-953a-7787b187be12": "howto",    // email-confirmation-flow
  "aeb20399-01fd-4672-9516-76d79bf422db": "howto",    // test-patterns-browser-mode
  "e23a4307-1afa-4887-a452-8831c9b784c2": "howto",    // langfuse deployment script
  "bb110d00-b61f-437d-8a4e-bf4bb7d8ce9e": "howto",    // mittwald-streamlit-app
  "6a94b1ea-2eeb-43f3-bbea-b24bf957c848": "howto",    // plugin-installation-guide
  "59e1cad2-10e9-43af-a1f3-78fbb2bfdae2": "howto",    // langfuse-mcp-integration
  "f7b57fd5-5826-4cb1-8d85-0ac24bf16784": "howto",    // docker-commands-odoo
  // lessons / learnings
  "923283e7-d222-4ba2-ac82-48ecb5855a3d": "lesson",   // StepsBar component learnings
  // knowledge / references / analysis
  "6a26960e-db87-4507-8dc1-3c7d6d5d03f4": "knowledge", // jobsuche-api-field-reference
  "adb20db5-7ee0-4ded-9dca-7ebc05d592f1": "knowledge", // assistant-improvement-findings
  "3ca357bc-3bcf-481e-88d4-7b75488d5978": "knowledge", // advisor-testing-findings
  "6d713fed-4a48-40d5-8b33-6251a1458199": "knowledge", // testability-analysis
  "4e7d442d-6d64-4afc-b5a1-d24981557762": "knowledge", // mittwald stack api docs
  "ca7f8615-0a54-4c07-8a97-667d50af4366": "knowledge", // mittwald api stack PUT schema
  "9557d71f-d81f-4c04-b78c-8ff57810e162": "knowledge", // Remote Langfuse no volumes
  "4952febf-2a79-47c9-adf1-601183a761e6": "knowledge", // Local vs Remote docker volumes
  "84d4beb7-9169-408c-8ffd-6e5ab9c3136f": "knowledge", // Langfuse local vs remote differences
  "860319ef-d735-4d5f-b702-7240b7249f0d": "knowledge", // Mittwald volumes vs host paths
  "0982491f-5f2f-4de1-bb64-4a759ef3e177": "knowledge", // mittwald-api-v2-docs
  "d792e657-ab35-4d3f-8d1c-906910d755bb": "knowledge", // mittwald-api-endpoints
  "909b649b-01a2-4a83-8031-5d1cc5b51c58": "review",    // CRITICAL_SECTIONS_review
  "1fb31f80-d69c-4a42-bbbd-9121866841dd": "knowledge", // current-implementation-analysis
  "0bc31ebd-2c29-43d4-8ed9-0fd253beb1eb": "knowledge", // langchain-langfuse-reasoning-analysis
  "c1622416-c636-4bb0-8f9f-91d33ab2f4bc": "knowledge", // langfuse-judge-overview
  "184a12d0-bb47-41ba-be1e-16cf63c202fa": "knowledge", // Langfuse Judge Score Recording
  "fb893df2-349d-4613-804b-8f939a9dcd8c": "knowledge", // Langfuse Annotation Queues
  "22bda15b-7c4b-43d1-aa96-c396f21f51d6": "knowledge", // langfuse-mcp-prompts-feature
  "f06ecafc-62f1-40a9-a852-4b6a15a0d7ca": "knowledge", // langfuse-mcp-prompts-feature (dup)
  "de187baa-a682-4de6-b699-02e3695b1258": "knowledge", // coresuite-integration-analysis
  "c4607bb9-1fb1-4829-9dfb-9e2b2f4af3f2": "knowledge", // yellowfox-integration-analysis
  "8a1aba86-c8cc-493e-ad60-ccc4c4dc33f7": "knowledge", // coresuite-wartungsbericht-api-fields
  "db954be5-ea59-494f-a150-abfc774f45ff": "knowledge", // odoo-db-tables
  "4a67b601-bd3a-4e87-90b4-43bd98ab040a": "knowledge", // odoo-db-schemas
  // implementations / completed work
  "7e18bc2b-2c1a-434a-8ceb-13bf037f0e6c": "implementation", // Final Registration Implementation
  "31d6e91b-c198-484d-8961-6da97c1739de": "implementation", // memory-improvements-completed
  "5614b531-0256-49a7-b5fc-c808b0de3a07": "implementation", // LLM Judge implementation and fixes
  "9546231c-b579-4966-addf-57b7a8dd2083": "implementation", // Langfuse Admin Implementation
  "2436613f-2d20-4930-b4cd-379839d34b59": "implementation", // skill-nodes-implementation
  "6c1bb220-b42b-4b96-aa22-2935dcff4f0d": "implementation", // enhancement:skill-nodes
  "9013c186-9b94-4fc6-974d-c8a37c223095": "implementation", // addyosmani-skills-import
  "7fba274c-1adf-4c92-a6eb-3c9e0d904691": "implementation", // refactor-filter-scene-oop
  "d0b3dd48-c681-4875-b744-99275b819ad2": "implementation", // enhancement-config-ui
  "8fedb6a0-e9a2-4fdd-9b7c-d6e7bdb7898b": "implementation", // mcp-server-implementation
  "d94906ba-3481-4468-874d-57368dad8e35": "implementation", // topic:locomo-benchmark-harness
  // tasks / feature requests
  "64d897d6-bef8-4776-b992-7f0a05d1dbbc": "task",     // Streamlit backup inspection features
  // improvements
  "4270a5a6-4f43-4122-8b79-a2e14d64977a": "improvement", // test-suite-expansion-2026-03
  // operational status notes
  "dc3f1be4-16e3-4b33-999c-c1d6cbec6fe8": "note",     // langfuse deployed mittwald
};

function log(msg: string) {
  console.log(`[${DRY_RUN ? "DRY-RUN" : "MIGRATE"}] ${msg}`);
}

async function main() {
  if (!DRY_RUN && !FORCE) {
    console.log("Pass --dry-run (preview only) or --force (apply changes).");
    process.exit(1);
  }

  const db = Database.open(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");

  const untyped = db.query(
    "SELECT id, label FROM memory_nodes WHERE type IS NULL AND label NOT LIKE 'rule:%'"
  ).all() as { id: string; label: string | null }[];

  const mapped = untyped.filter(n => ID_TYPE[n.id]);
  const unmapped = untyped.filter(n => !ID_TYPE[n.id]);

  log(`Remaining untyped content nodes: ${untyped.length}`);
  log(`  Mapped: ${mapped.length}`);
  log(`  Unmapped: ${unmapped.length}`);

  const byType: Record<string, number> = {};
  for (const m of mapped) byType[ID_TYPE[m.id]] = (byType[ID_TYPE[m.id]] ?? 0) + 1;
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    log(`    ${t}: ${c}`);
  }

  for (const u of unmapped) {
    log(`  UNMAPPED: ${u.label}`);
  }

  if (!DRY_RUN && mapped.length > 0) {
    const stmt = db.prepare("UPDATE memory_nodes SET type = ?, category = ? WHERE id = ?");
    const txn = db.transaction(() => {
      for (const m of mapped) {
        const type = ID_TYPE[m.id];
        const category = type === "task" || type === "plan" ? "episodic" : "semantic";
        stmt.run(type, category, m.id);
      }
    });
    txn();
    log(`Done — ${mapped.length} nodes reclassified`);
  }

  // Phase 2: reclassify remaining mislabeled content notes (label/content-driven)
  const NOTE_LABEL_TYPE: Array<[string, string]> = [
    ["implementation:usefulness-tracking-2026-03-27", "implementation"],
    ["research:memory-injection-improvements-2026-04-17", "research"],
    ["task:add-skills-to-seed-2026-06-03", "task"],
    ["improvement:new-sdk-hooks-wired", "improvement"],
    ["memory-quick-start", "howto"],
    ["deployment-procedure", "howto"],
    ["memory-philosophy", "knowledge"],
    ["current-state", "knowledge"],
    ["fractal-tools", "knowledge"],
    ["openidea:fractal-memory-enhancements", "idea"],
    ["improvement-ideas", "idea"],
    ["self-improvement-research", "research"],
    ["auto-retrieve-debug", "debug-investigation"],
    ["ollama-memory-feature", "implementation"],
    ["auto-retrieve-fix-complete", "fix"],
    ["injection-scoring-improved", "improvement"],
    ["plugin-refactoring-plan", "plan"],
    ["enhancements-llm-compress-auto-distill-predictive-rating", "plan"],
    ["p3-refactoring-2026-06-02", "plan"],
    ["refactoring-memoryplugin-decomposition-2026-06-02", "plan"],
    ["project", "project"],
    ["wasgehtbesser-project", "project"],
    ["svelte-check-errors-overview", "bug"],
    ["advisor-protocol-research", "research"],
    ["stock-lot-filter-approach", "knowledge"],
    ["lot-traceability-improvement-research", "research"],
    ["enhancements-smartfilter-signal-relevant", "knowledge"],
  ];
  const notes = db.query("SELECT id, label FROM memory_nodes WHERE type = 'note'").all() as { id: string; label: string | null }[];
  const notePlan = notes.filter(n => NOTE_LABEL_TYPE.some(([l]) => l === n.label)).map(n => ({
    id: n.id,
    label: n.label ?? "",
    type: NOTE_LABEL_TYPE.find(([l]) => l === n.label)![1],
  }));
  log(`Notes to reclassify: ${notePlan.length}`);
  if (!DRY_RUN && notePlan.length > 0) {
    const stmt = db.prepare("UPDATE memory_nodes SET type = ?, category = ? WHERE id = ?");
    const txn = db.transaction(() => {
      for (const p of notePlan) {
        const category = p.type === "task" || p.type === "plan" ? "episodic" : "semantic";
        stmt.run(p.type, category, p.id);
      }
    });
    txn();
    log(`Done — ${notePlan.length} notes reclassified`);
  }

  db.close();
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
