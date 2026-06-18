export const CATEGORY_LABELS: Record<number, string> = {
  1: "direct",
  2: "paraphrase",
  3: "ambiguous",
  4: "hard_negative",
  5: "temporal",
  6: "adversarial",
};

export type SyntheticNode = {
  label: string;
  content: string;
  type: string;
  importance: number;
};

export type SyntheticQA = {
  question: string;
  evidence: string[];
  category: number;
};

export type TemporalEdgeDef = {
  sourceLabel: string;
  targetLabel: string;
  edgeType: string;
};

export const NODES: SyntheticNode[] = [
  // ── File summaries (15) ──
  {
    label: "file:src/storage/search.ts",
    content: "Implements the hybrid search combining HNSW vector similarity with BM25 keyword scoring. The searchByEmbedding function takes a query embedding vector plus optional queryText for BM25, retrieves candidate nodes via HNSW approximate nearest neighbor, computes BM25 scores for keyword overlap, then merges them using a weighted combination. Supports reranking by keyword overlap and temporal context expansion by following NEXT edges from top results. Returns top-K MemoryNodes sorted by descending combined score.",
    type: "summary",
    importance: 0.8,
  },
  {
    label: "file:src/embeddings/index.ts",
    content: "ONNX-based embedding generation using the all-MiniLM-L6-v2 sentence transformer model. The generateEmbedding function takes a text string, tokenizes it, runs inference through the ONNX session, and returns a 384-dimensional Float32Array embedding vector. Model files are stored locally under ~/.config/opencode/models/Xenova/all-MiniLM-L6-v2/. Typical inference latency is around 10 milliseconds per call.",
    type: "summary",
    importance: 0.8,
  },
  {
    label: "file:src/storage/sqlite.ts",
    content: "SQLite-backed implementation of the MemoryStore interface using better-sqlite3. Uses WAL journal mode for concurrent read performance during writes. Schema includes nodes table with JSON metadata, edges_temporal for temporal relationships, and bm25_index for keyword frequency scoring. Factory function createSqliteMemoryStore accepts an optional explicit dbPath parameter. Supports listNodes, getNode, createNode, updateNode, deleteNode, searchByEmbedding, and all temporal edge operations.",
    type: "summary",
    importance: 0.8,
  },
  {
    label: "file:src/storage/queries/search-helpers.ts",
    content: "Helper functions for BM25 scoring in hybrid search. bm25Score computes term frequency and inverse document frequency for query terms against each node's content. Uses IN clause instead of OR chain when building the SQL for term matching to avoid SQLite's 1000-expression AST depth limit. normalizeBm25Scores applies min-max normalization to BM25 raw scores before merging with vector similarity scores.",
    type: "summary",
    importance: 0.8,
  },
  {
    label: "file:src/plugin/hooks.ts",
    content: "OpenCode plugin lifecycle hooks. The tool.execute.before hook reads the file-summary cache: for each file being read, it checks if a cached summary node exists and validates staleness by comparing file mtime against the node's updatedAt timestamp. If the file is newer, logs FILE-CACHE-STALE and skips the cached summary, triggering regeneration in the after hook. Also handles memory injection into agent context before tool calls.",
    type: "summary",
    importance: 0.7,
  },
  {
    label: "file:src/storage/types.ts",
    content: "Core TypeScript interfaces for the memory system. Defines MemoryNode with fields id, scope, label, content, summary, level, embedding, createdAt, updatedAt, importance, type, category, metadata, and more. Also defines MemoryStore interface listing all operations including searchByEmbedding with its options type. Exports CreateNodeInput, FractalStats, TemporalEdge, and related types used across the codebase.",
    type: "summary",
    importance: 0.7,
  },
  {
    label: "file:scripts/seed-loco-db.ts",
    content: "LoCoMo dataset seed script. Reads the locomo10.json file containing 10 long-form conversations with 5882 total turns. For each turn, generates an embedding via the ONNX model, creates a memory node with a label like conv-26-D1:3 and content like Speaker: text. Links consecutive turns with NEXT temporal edges and each turn to its session summary with DURING_SESSION edges. After all turns are ingested, rebuilds the HNSW index and BM25 index. Generates QA embeddings as a JSON sidecar file. Takes about 4 minutes to run.",
    type: "summary",
    importance: 0.6,
  },
  {
    label: "file:src/storage/search.loco.test.ts",
    content: "LoCoMo-based retrieval quality test. Three tests: verifying the pre-seeded database exists, loading the database and QA embeddings with per-category summary, and running retrieval metrics across all 1986 QA pairs. Each QA pair embeds the question, searches via searchByEmbedding with bm25Weight 0.4, then computes HitRate, Recall, Precision, and MRR at K values 3 5 and 10 across single_hop multi_hop temporal commonsense and adversarial categories. Reports formatted results table.",
    type: "summary",
    importance: 0.6,
  },
  {
    label: "file:scripts/opencode-backup.sh",
    content: "Shell script for backing up all OpenCode configuration. Creates a timestamped tarball containing ~/.opencode ~/.config/opencode ~/.cache/opencode and ~/.local/share/opencode directories. Uses home-relative path transformation for portable archives. Supports two modes: backup by passing backup and a destination path, and restore by extracting the tarball with reverse path transform.",
    type: "summary",
    importance: 0.5,
  },
  {
    label: "file:tiers.json",
    content: "Configuration file for the model router tier system. Defines named presets each specifying a subagent type mode and provider. The activePreset field controls which preset is currently active. Key presets include local for local models and openrouter for API-based routing. Switching activePreset from local to openrouter fixed connectivity issues with subagent API calls.",
    type: "summary",
    importance: 0.5,
  },
  {
    label: "file:src/storage/queries/bm25-index.ts",
    content: "BM25 index maintenance module. refreshIndex rebuilds the entire keyword frequency table by scanning all node content, tokenizing into terms, and storing term frequency per node alongside corpus-level document frequency. updateIndex supports incremental addition of new nodes without full rebuild. Used by backfillBinaryEmbeddingsAndBM25 and rebuildHNSWIndex in the store.",
    type: "summary",
    importance: 0.6,
  },
  {
    label: "file:scripts/benchmark/datasets/locomo.ts",
    content: "TypeScript types and dataset loader for the LoCoMo benchmark. Defines Turn QAPair and Conversation interfaces matching the JSON structure of locomo10.json. Exports CATEGORY_LABELS mapping numeric category IDs 1-5 to names single_hop multi_hop temporal commonsense adversarial. The loadDataset function reads a JSON file and normalizes it into a Conversation array.",
    type: "summary",
    importance: 0.5,
  },
  {
    label: "file:src/embeddings/onnx.ts",
    content: "Low-level ONNX Runtime wrapper for embedding inference. Handles model loading from local filesystem path, inference session creation with appropriate execution providers, input tensor creation from tokenized text, and output tensor extraction. Manages session lifecycle with lazy initialization and caching for reuse across calls.",
    type: "summary",
    importance: 0.6,
  },
  {
    label: "file:package.json",
    content: "Project package manifest. Defines dependencies including better-sqlite3 for database, ONNX Runtime for embeddings, and TypeScript for type safety. Uses bun as the JavaScript runtime. Scripts section includes dev build test and seed commands. The project name is opencode-agent-memory and it implements a fractal memory system for the OpenCode AI coding assistant.",
    type: "summary",
    importance: 0.4,
  },
  {
    label: "file:.vscode/launch.json",
    content: "VSCode debug launch configurations for the project. Includes entries for Debug LoCoMo Retrieval Test which runs the search.loco.test.ts with the Bun test runner, Seed LoCoMo Database for running the seed-loco-db.ts script, and Seed LoCoMo DB sample for running with a limited sample of 100 QA pairs.",
    type: "summary",
    importance: 0.4,
  },

  // ── Bug workarounds (8) ──
  {
    label: "bug:sqlite-expression-depth-limit",
    content: "BM25 query construction in search-helpers.ts uses OR chain for term matching which hits SQLite's expression tree depth limit at around 1000 terms. Fix was to rewrite the query using IN clause instead of OR chain. The IN clause treats the term list as a set membership test which does not build a deep expression tree. Applied at search-helpers.ts line 216.",
    type: "fact",
    importance: 0.7,
  },
  {
    label: "bug:locomo-db-contamination",
    content: "The first run of seed-loco-db.ts wrote 6154 LoCoMo nodes to ~/.config/opencode/memory.db instead of the intended tests/dbs/locomo-seeded/memory.db. Root cause: createSqliteMemoryStore defaults to user config path when no explicit dbPath is provided. Fix: always pass an explicit globalDbPath parameter to createSqliteMemoryStore when working with evaluation databases.",
    type: "fact",
    importance: 0.7,
  },
  {
    label: "bug:searchByEmbedding-type-mismatch",
    content: "The MemoryStore interface in types.ts defines searchByEmbedding with an options type that is missing the temporalHops and categoryFilter fields that the internal search function accepts. The types are narrower than the actual implementation. Workaround is to cast options as any when calling through the MemoryStore interface.",
    type: "fact",
    importance: 0.6,
  },
  {
    label: "bug:model-router-connection",
    content: "Subagent API calls failed with error Cannot connect to API when the model router was configured with activePreset set to local. The local preset attempted to use local models that were not running. Fix: switch activePreset from local to openrouter in tiers.json to route through the OpenRouter API endpoint.",
    type: "fact",
    importance: 0.7,
  },
  {
    label: "bug:git-credentials-missing",
    content: "Git push fails in the development environment because no git credentials are configured. The environment lacks both SSH keys and git credential helpers for HTTPS. Workaround is to commit locally and defer pushing until credentials are available. All commits remain local-only.",
    type: "fact",
    importance: 0.4,
  },
  {
    label: "bug:file-cache-staleness",
    content: "File cache returned stale summaries when a source file was edited after its summary was generated. The cache check only verified existence, not freshness. Fix implemented in hooks.ts: compare fs.statSync(filePath).mtime against the cached summary nodes updatedAt value. If the file is newer, the summary is considered stale and regeneration is triggered.",
    type: "fact",
    importance: 0.7,
  },
  {
    label: "bug:test-timeout-temporal-expansion",
    content: "Enabling temporalHops 2 in the LoCoMo retrieval test increased runtime from 66 seconds to 276 seconds a 4x slowdown. The temporal expansion queries edges for all top-5 result nodes per search, and with 1986 QA pairs each making 5 edge queries the overhead accumulates significantly. The metric results were unchanged between the two configurations.",
    type: "fact",
    importance: 0.5,
  },
  {
    label: "bug:npm-vulnerability-fix",
    content: "Running npm audit fix resolved 2 vulnerabilities in project dependencies: 1 moderate severity and 1 high severity. The vulnerabilities were in transitive dependencies and did not directly affect the memory plugin functionality but were flagged for security compliance.",
    type: "fact",
    importance: 0.4,
  },

  // ── Preferences (6) ──
  {
    label: "pref:testing",
    content: "Use bun test as the test runner, not jest. Vitest configuration is bun-native. Test files use the .test.ts suffix convention and are co-located near their source files. The bun test command provides fast startup and built-in TypeScript support without configuration.",
    type: "note",
    importance: 0.5,
  },
  {
    label: "pref:code-style",
    content: "No comments in production code files. Use TypeScript strict mode. No emojis in code unless the user explicitly requests them. Error messages should be concise and informative. Import statements follow the path alias convention using ../src/ style relative imports.",
    type: "note",
    importance: 0.5,
  },
  {
    label: "pref:embedding-model",
    content: "Use the local ONNX all-MiniLM-L6-v2 model for embeddings. Do not use API-based embedding services. The local model provides approximately 10 milliseconds per inference latency with 384-dimensional output vectors. The model files are cached at ~/.config/opencode/models/Xenova/all-MiniLM-L6-v2/.",
    type: "note",
    importance: 0.6,
  },
  {
    label: "pref:database",
    content: "Use SQLite with WAL journal mode as the database backend. Use better-sqlite3 as the synchronous JavaScript driver. No PostgreSQL MySQL or external database services. WAL mode enables concurrent reads during write operations which is important for the memory plugin.",
    type: "note",
    importance: 0.5,
  },
  {
    label: "pref:git-practices",
    content: "Only commit changes when the user explicitly asks. Never use force-push or skip git hooks. Write concise conventional commit messages. Never amend commits unless the user requests it. Do not create empty commits.",
    type: "note",
    importance: 0.4,
  },
  {
    label: "pref:logging",
    content: "Use structured logging with level prefixes. Debug level for search operations and internal details. Info level for state transitions and configuration changes. Warn level for recoverable issues. Error level for failures. Log messages should be concise and include relevant context identifiers.",
    type: "note",
    importance: 0.4,
  },

  // ── Architecture decisions (8) ──
  {
    label: "decision:bm25-over-vector",
    content: "BM25 keyword scoring supplements vector similarity search to improve exact term matching. The hybrid score combines cosine similarity from HNSW with normalized BM25 score using a configurable weight. The weight parameter bm25Weight defaults to 0.4 meaning the final score is 0.6 times vector similarity plus 0.4 times BM25 normalized score. This improves retrieval for code-specific terms like function names and variable names that embeddings alone may not capture precisely.",
    type: "concept",
    importance: 0.7,
  },
  {
    label: "decision:onnx-over-api",
    content: "Chose local ONNX embeddings over cloud API services like OpenAI or Cohere for three reasons. Latency: local inference averages 10ms versus 500ms for API calls. Privacy: no source code content leaves the machine. Offline capability: embeddings work without internet connectivity. The tradeoff is slightly lower embedding quality compared to larger cloud models but the difference is acceptable for the memory retrieval use case.",
    type: "concept",
    importance: 0.7,
  },
  {
    label: "decision:hnsw-over-flat",
    content: "Selected HNSW hierarchical navigable small world index for approximate nearest neighbor search over brute-force flat search. HNSW provides logarithmic search complexity versus linear for flat search. With 5000 or more nodes the speed difference is substantial. The index is rebuilt after seed operations via rebuildHNSWIndex. The tradeoff is approximate results but the recall at 10 remains above 95 percent for the typical use case.",
    type: "concept",
    importance: 0.6,
  },
  {
    label: "decision:wal-mode",
    content: "Enabled SQLite WAL write-ahead logging journal mode for the memory database. WAL mode allows concurrent readers to proceed without blocking during write operations. This is important for the memory plugin which can receive read requests from the agent while background operations like compression or injection are writing. The tradeoff is slightly larger database files but the concurrency benefit outweighs the storage cost.",
    type: "concept",
    importance: 0.5,
  },
  {
    label: "decision:temporal-expansion",
    content: "Search augmentation that follows temporal edges from top retrieved nodes to surface adjacent context. When temporalHops is set for example to 2 the search takes the top 5 result nodes queries their outgoing NEXT edges and adds those neighboring nodes to the result set with a decaying score. Designed to capture conversation flow where the directly relevant turn may be preceded or followed by contextual turns.",
    type: "concept",
    importance: 0.6,
  },
  {
    label: "decision:rerank-keyword",
    content: "Keyword overlap reranking applied after hybrid score merge. The reranker checks how many query tokens appear in each candidate node and adjusts the ranking to prefer exact keyword matches. This slightly improves precision on queries with specific technical terms. The effect is most noticeable for queries containing function names or configuration keys.",
    type: "concept",
    importance: 0.5,
  },
  {
    label: "decision:seed-separate-from-test",
    content: "Database seeding is kept as a separate script rather than inline in the test suite. The seed-loco-db.ts script runs independently and takes about 4 minutes to complete. Tests check for database existence and skip with a helpful message if the seeded database is not found. This separation avoids slow setup in the test run loop and allows the seeded database to be reused across multiple test runs.",
    type: "concept",
    importance: 0.5,
  },
  {
    label: "decision:category-filter-available",
    content: "The searchByEmbedding function internally supports categoryFilter and typeFilter parameters but these are not exposed in the MemoryStore interface options type. The internal search function from search.ts accepts these filters directly. Using them requires calling the internal function or casting through the MemoryStore interface.",
    type: "concept",
    importance: 0.4,
  },

  // ── Concepts (6) ──
  {
    label: "concept:hybrid-search",
    content: "Hybrid search merges two retrieval signals: vector similarity using cosine distance on HNSW embeddings captures semantic meaning while BM25 keyword scoring captures exact term overlap. The combined score is computed as vectorSimilarity times one minus bm25Weight plus bm25Normalized times bm25Weight. Default bm25Weight is 0.4 giving slightly more weight to semantic similarity.",
    type: "fact",
    importance: 0.7,
  },
  {
    label: "concept:memory-injection",
    content: "Memory injection is the process of automatically selecting relevant memory nodes from the store and inserting them into the agent's prompt context before tool execution. The selection uses the user's message as a query searching by embedding with BM25 hybrid scoring. The injected nodes provide context for the agent to make better decisions. Injection metrics are logged per session.",
    type: "fact",
    importance: 0.7,
  },
  {
    label: "concept:file-summary-cache",
    content: "Each source file in the project can have an associated file-summary memory node. The summary is generated automatically by the plugin hooks when a file is read. The cache is validated by comparing the file's modification timestamp against the summary node's updatedAt date. If the file is newer the summary is stale and regeneration is triggered. Summary nodes use the label pattern file:path.",
    type: "fact",
    importance: 0.6,
  },
  {
    label: "concept:fractal-memory",
    content: "Fractal memory organizes nodes into compression levels from 0 raw detail up to 5 highest abstraction. Lower level nodes are compressed into higher level summaries based on similarity and temporal proximity. Each node can have parent references to its compressed version. The system supports drilldown from summaries back to source details. This enables efficient context management by choosing an appropriate compression level for the current task.",
    type: "fact",
    importance: 0.6,
  },
  {
    label: "concept:bm25-scoring",
    content: "BM25 is a bag-of-words ranking function that scores documents by term frequency and inverse document frequency. For each query term the score contribution is the term frequency in the document divided by the term frequency plus a saturation constant k1 times one minus b plus b times document length divided by average document length. The scores are summed across all query terms then normalized for combination with vector similarity.",
    type: "fact",
    importance: 0.5,
  },
  {
    label: "concept:temporal-edges",
    content: "Temporal edges connect memory nodes to represent chronological relationships. The NEXT edge type links consecutive turns in a conversation or session. The DURING_SESSION edge type links all turns in a session to the session summary. These edges enable temporal context expansion during search and provide the structure for conversation flow traversal.",
    type: "fact",
    importance: 0.5,
  },

  // ── Playbooks (5) ──
  {
    label: "playbook:re-seed-locomo",
    content: "To regenerate the LoCoMo evaluation database run bun run scripts/seed-loco-db.ts from the project root. This takes approximately 4 minutes. After completion verify that tests/dbs/locomo-seeded/memory.db exists. Then run the retrieval quality test with bun test src/storage/search.loco.test.ts. Optionally use --sample 100 for a quick validation run.",
    type: "playbook",
    importance: 0.6,
  },
  {
    label: "playbook:seed-synthetic",
    content: "To regenerate the synthetic evaluation database run bun run scripts/seed-synthetic-db.ts. This takes approximately 2 minutes for the full set of 66 nodes and 100 QA pairs. After completion verify that tests/dbs/synthetic-seeded/memory.db exists. Run the evaluation with bun test src/storage/search.synthetic.test.ts.",
    type: "playbook",
    importance: 0.6,
  },
  {
    label: "playbook:debug-search-quality",
    content: "To debug search quality first run the retrieval test bun test src/storage/search.loco.test.ts. Review per-category metrics: hit rate recall precision and MRR. If precision is below 20 percent examine the top non-evidence results to understand what false positives dominate. Common issues: cross-conversation noise from similar topics or embedding collisions between related but distinct concepts.",
    type: "playbook",
    importance: 0.5,
  },
  {
    label: "playbook:add-evaluation-data",
    content: "To add new evaluation data first define new nodes in the NODES array with label content type and importance. Add corresponding QA pairs in the QAS array with question evidence labels and category. Run the seed script to rebuild the database. Then run the test to verify new metrics are computed correctly. Ensure evidence labels exactly match the node labels used in NODES.",
    type: "playbook",
    importance: 0.5,
  },
  {
    label: "playbook:upgrade-embedding-model",
    content: "To upgrade the embedding model download the new ONNX model files to the models directory under ~/.config/opencode/models/. Update the model path in src/embeddings/onnx.ts and verify the output dimension matches expectations. Run the seed scripts to regenerate all node embeddings. Compare retrieval metrics before and after to validate improvement.",
    type: "playbook",
    importance: 0.4,
  },

  // ── Conversation logs / sessions (8) ──
  {
    label: "session:locomo-initial-results",
    content: "First full run of the LoCoMo retrieval quality test showed hit rate at K equals 5 ranging from 9.8 percent for temporal questions up to 33.6 percent for multi-hop. Precision across all categories was approximately 12 percent meaning only 1 in 8 returned results was an actual evidence node. The temporal category was the weakest performer with single-digit hit rates. The team concluded that single-turn evidence approach with 384-dimensional embeddings has inherent limitations for precise retrieval.",
    type: "event",
    importance: 0.6,
  },
  {
    label: "session:search-tweak-experiments",
    content: "Experiments with search configuration parameters showed that enabling rerank true and temporalHops 2 produced no significant improvement over baseline metrics. The test runtime increased from 66 seconds to 276 seconds due to temporal edge queries. Determined the embedding model is the primary bottleneck for retrieval quality. The experiments confirmed that config tweaks alone cannot overcome the semantic gap between embedding similarity and ground-truth relevance.",
    type: "event",
    importance: 0.6,
  },
  {
    label: "session:database-pollution",
    content: "Accidentally wrote 6154 LoCoMo evaluation nodes to the real user memory database at ~/.config/opencode/memory.db. The first seed script call did not specify an explicit database path so createSqliteMemoryStore defaulted to the user config location. Cleanup involved deleting all LoCoMo-prefixed nodes from the real database and adding transient SQLite files to .gitignore. Added explicit path parameter to all subsequent seed script calls.",
    type: "event",
    importance: 0.6,
  },
  {
    label: "session:model-router-fix",
    content: "Subagent API was not connecting because tiers.json had activePreset set to local. The local preset expects locally running models but no local model server was available. Changed activePreset to openrouter which routes through the configured API endpoint. Subagent calls immediately started working after the change. Root cause was a leftover configuration from an earlier local development setup.",
    type: "event",
    importance: 0.5,
  },
  {
    label: "session:backup-script",
    content: "Created opencode-backup.sh to provide a single-command backup and restore solution for all OpenCode configuration. The script archives four directories: ~/.opencode ~/.config/opencode ~/.cache/opencode and ~/.local/share/opencode. Uses tar with home-relative path transformation so the same tarball can be restored on a different machine. Supports backup and restore modes.",
    type: "event",
    importance: 0.4,
  },
  {
    label: "session:locomo-audit-discovery",
    content: "Discovered the LoCoMo dataset has known issues through the dial481/locomo-audit repository. The audit found 99 ground truth errors out of 1540 questions a 6.4 percent error rate. Category 5 adversarial questions have a broken evaluation formatter that references a missing field on 444 out of 446 questions. Category sample sizes vary by 8.8x between smallest and largest causing statistical validity concerns.",
    type: "event",
    importance: 0.6,
  },
  {
    label: "session:synthetic-data-planning",
    content: "Planned the synthetic evaluation dataset to better match real OpenCode memory usage patterns. The dataset includes 66 nodes across file summaries bug workarounds preferences architecture decisions concepts playbooks and conversation logs. QA pairs are organized into six categories: direct paraphrase ambiguous hard-negative temporal and adversarial. Node content averages 3 to 5 sentences matching real memory node length.",
    type: "event",
    importance: 0.5,
  },
  {
    label: "session:mtime-staleness-implementation",
    content: "Implemented file cache staleness detection in the plugin hooks. The tool.execute.before hook now calls fs.statSync on each file being read to get its mtime modification timestamp. This is compared against the cached summary node's updatedAt field. If the file mtime is more recent the cache is considered stale and the existing summary is not returned. The after hook regenerates the summary on the next read.",
    type: "event",
    importance: 0.5,
  },

  // ── Batch 2: More file summaries (5) ──
  {
    label: "file:src/storage/migrations/definitions.ts",
    content: "SQLite schema migration definitions for the memory store. Defines the tables: memory_nodes with columns for id, scope, label, content, summary, level, embedding, timestamps, importance, type, category, metadata JSON, and various scoring fields. Also defines edges_temporal for temporal relationships and bm25_index for keyword frequency. Migration functions handle version tracking and incremental schema upgrades.",
    type: "summary",
    importance: 0.7,
  },
  {
    label: "file:src/math.ts",
    content: "Vector math utilities for the memory system. Implements cosineSimilarity for comparing embedding vectors which is the core distance metric used in HNSW search and hybrid scoring. Also includes normalization helpers like normalizeVector for unit-length conversion and euclideanDistance as an alternative distance metric. All operations work on Float32Array or number arrays.",
    type: "summary",
    importance: 0.6,
  },
  {
    label: "file:src/hnsw-index.ts",
    content: "HNSW hierarchical navigable small world index singleton manager. Provides getHNSWIndex to access the shared index instance, rebuildHNSWIndex to rebuild from all nodes with embeddings, and insertIntoHNSWIndex for incremental addition. The index supports approximate nearest neighbor search returning candidate IDs with cosine similarity scores. The index is shared across scopes and rebuilt during seed operations.",
    type: "summary",
    importance: 0.7,
  },
  {
    label: "file:src/mcp/server.ts",
    content: "MCP Model Context Protocol server implementation. Handles incoming MCP requests from AI coding assistants, routes them to the appropriate memory store operations, and returns structured responses. Supports tools like memory_search, memory_get, memory_set, and memory_delete exposed through the MCP protocol. Uses the standard MCP transport layer with JSON-RPC message formatting.",
    type: "summary",
    importance: 0.5,
  },
  {
    label: "file:src/config.ts",
    content: "Project configuration defaults and environment variable mapping. Defines default values for memory store paths, embedding model location, HNSW index parameters, BM25 tuning constants, and search result limits. Reads environment variables to override defaults. Exported constants are imported by other modules to ensure consistent configuration across the codebase.",
    type: "summary",
    importance: 0.5,
  },

  // ── Batch 2: More bugs (5) ──
  {
    label: "bug:stack-overflow-rerank",
    content: "The rerankResults function in search-helpers.ts can hit a stack overflow when processing nodes with very long content strings. The rerank logic computes pairwise similarity between query tokens and content tokens which can produce deep recursion on large documents. The workaround is to truncate content to 2000 characters before reranking. A long-term fix would use iterative instead of recursive processing.",
    type: "fact",
    importance: 0.5,
  },
  {
    label: "bug:hnsw-rebuild-crash",
    content: "HNSW index rebuild crashes when nodes with identical embedding vectors are inserted. The HNSW algorithm assumes distinct vectors for distance calculations and identical vectors produce undefined behavior in the graph construction. The fix adds a deduplication check that skips nodes with embeddings identical to an already-indexed vector within a small epsilon tolerance.",
    type: "fact",
    importance: 0.6,
  },
  {
    label: "bug:sqlite-busy-timeout",
    content: "Concurrent write operations from compression and injection processes cause SQLITE_BUSY errors. The WAL mode allows concurrent reads but write transactions still conflict. The fix increased the busy timeout from 1000ms to 5000ms and added retry logic with exponential backoff for write operations. The PRAGMA busy_timeout setting was updated in the database initialization code.",
    type: "fact",
    importance: 0.6,
  },
  {
    label: "bug:empty-embedding-search",
    content: "Searching with an all-zero embedding vector returns zero results because the HNSW index cannot compute meaningful distances from a zero vector. The cosine similarity of a zero vector is zero with every other vector making all results equally distant. The fix adds a fallback that returns the most recently accessed nodes when the query embedding is a zero vector or below a minimum norm threshold.",
    type: "fact",
    importance: 0.5,
  },
  {
    label: "bug:edge-orphan-nodes",
    content: "Deleting a memory node leaves its temporal edges dangling in the edges_temporal table. The deleteNode operation does not cascade to remove edges referencing the deleted node. This causes the temporal expansion feature to return stale node references that fail on lookup. The fix adds an ON DELETE CASCADE foreign key constraint or explicit edge cleanup in the delete function.",
    type: "fact",
    importance: 0.5,
  },

  // ── Batch 2: More decisions (5) ──
  {
    label: "decision:bm25-in-clause",
    content: "The BM25 term matching query was rewritten from an OR chain to an IN clause to avoid SQLite's 1000-expression AST depth limit. The IN clause treats the term list as a set membership test that does not build a deep expression tree. This was critical for supporting large vocabularies where the number of distinct query terms could exceed the AST depth limit of approximately 1000 nodes.",
    type: "concept",
    importance: 0.6,
  },
  {
    label: "decision:importance-scoring",
    content: "The final node importance score in search results combines vector similarity, BM25 keyword match, recency, and level weight. The formula is vectorScore times semanticWeight plus bm25Score times bm25Weight, multiplied by recency boost, level weight, confidence weight, and category weight. The recency boost adds up to 20 percent bonus for recently accessed nodes based on lastAccessed timestamp.",
    type: "concept",
    importance: 0.6,
  },
  {
    label: "decision:memory-seed-strategy",
    content: "Memory database seeding uses a one-time seed script approach rather than lazy generation on first access. The seed script runs independently populating the database with all nodes and rebuilding indexes. Tests check for database existence and skip with helpful instructions if not found. This separates the slow seed process from the fast test execution allowing iteration without re-seeding.",
    type: "concept",
    importance: 0.5,
  },
  {
    label: "decision:project-scope-isolation",
    content: "Each project gets its own isolated memory database via the project scope. The global scope stores cross-project shared memories like user preferences and system prompts. The project scope stores project-specific file summaries, bug workarounds, and decisions. This isolation prevents memory from one project leaking into another while allowing shared global context.",
    type: "concept",
    importance: 0.5,
  },
  {
    label: "decision:retry-on-failure",
    content: "Database operations use withRetry wrapper that retries failed operations with exponential backoff. The retry starts at 100ms and doubles up to 2 seconds, with a maximum of 5 retries. This handles transient failures from SQLITE_BUSY, SQLITE_LOCKED, and other temporary conditions without crashing the caller. The retry logs each attempt for debugging.",
    type: "concept",
    importance: 0.5,
  },

  // ── Batch 2: More concepts (4) ──
  {
    label: "concept:hnsw-index",
    content: "HNSW Hierarchical Navigable Small World is an approximate nearest neighbor search algorithm. It builds a multi-layer graph where higher layers have fewer nodes connected by longer edges for fast coarse search and lower layers have more nodes with shorter edges for fine-grained refinement. Search starts at the top layer and descends greedily. Construction complexity is O(n log n) and search complexity is O(log n) per query.",
    type: "fact",
    importance: 0.6,
  },
  {
    label: "concept:sqlite-migrations",
    content: "SQLite schema migrations use a version tracking table to apply incremental schema changes. Each migration has a version number, description, and SQL statements. On database initialization the code checks the current version and applies all pending migrations in order. This enables schema evolution without manual database recreation. The migration system is defined in src/storage/migrations/definitions.ts.",
    type: "fact",
    importance: 0.5,
  },
  {
    label: "concept:edge-traversal",
    content: "Memory nodes are connected by typed edges for traversal. Temporal edges represent chronological relationships using types like NEXT for sequential turns and DURING_SESSION for turn-to-session membership. The expandWithTemporalContext function follows these edges from seed nodes up to a configurable hop depth. Edge traversal enables retrieving contextually adjacent nodes that may not be semantically similar.",
    type: "fact",
    importance: 0.5,
  },
  {
    label: "concept:score-decay",
    content: "Memory node usefulness scores decay over time to surface recent and frequently used information over stale entries. The runScoreDecay function applies a decay factor to all nodes based on days since last access. Nodes accessed within the decay window retain higher scores while unaccessed nodes gradually decrease. Combined with importance-based retention this ensures the memory system prioritizes active information.",
    type: "fact",
    importance: 0.5,
  },

  // ── Batch 2: More sessions (4) ──
  {
    label: "session:hnsw-rebuild-issue",
    content: "Discovered that HNSW index rebuild crashes when multiple nodes have identical embedding vectors. The HNSW graph construction produces undefined behavior with zero-distance neighbors. Debugged by adding logging around the insert step and found duplicate embeddings from auto-generated summary nodes. Applied dedup check that skips nodes within epsilon tolerance and the rebuild succeeded.",
    type: "event",
    importance: 0.5,
  },
  {
    label: "session:sqlite-concurrency-fix",
    content: "Memory plugin was throwing SQLITE_BUSY errors during concurrent compression and injection operations. WAL mode was already enabled but busy timeout was too low. Increased busy_timeout PRAGMA from 1000ms to 5000ms and added withRetry wrapper with exponential backoff to all write operations. Verified fix by running compression and injection simultaneously which no longer produces conflicts.",
    type: "event",
    importance: 0.5,
  },
  {
    label: "session:rerank-performance",
    content: "Reranker was causing stack overflow on nodes with content over 2000 characters. The pairwise token comparison uses recursive calls that exceed the call stack for long content. Applied content truncation before reranking as a workaround. Also measured that rerank adds about 15 percent to total search time. Considering iterative rewrite for long-term fix.",
    type: "event",
    importance: 0.4,
  },
  {
    label: "session:score-decay-tuning",
    content: "Calibrated the score decay parameters to balance between forgetting old information and retaining useful historical context. Initial decay window of 7 days was too aggressive and pruned useful debugging notes. Settled on 30 day decay window with 0.5 decay factor. Also added importance threshold below which decay is accelerated. The tuning improved long-running session stability.",
    type: "event",
    importance: 0.4,
  },
];

export const QAS: SyntheticQA[] = [
  // ── Direct (25) ──
  { question: "What function implements the hybrid search combining vector similarity with BM25 scoring?", evidence: ["file:src/storage/search.ts"], category: 1 },
  { question: "Where can I find the ONNX embedding generation code?", evidence: ["file:src/embeddings/index.ts"], category: 1 },
  { question: "What SQLite-backed store factory function returns a MemoryStore interface?", evidence: ["file:src/storage/sqlite.ts"], category: 1 },
  { question: "Which helper module contains the BM25 IN clause fix for SQLite expression depth limit?", evidence: ["file:src/storage/queries/search-helpers.ts"], category: 1 },
  { question: "What plugin hook checks file mtime for cache staleness?", evidence: ["file:src/plugin/hooks.ts"], category: 1 },
  { question: "Which file defines the MemoryNode TypeScript interface?", evidence: ["file:src/storage/types.ts"], category: 1 },
  { question: "What script seeds the LoCoMo conversation data into a memory database?", evidence: ["file:scripts/seed-loco-db.ts"], category: 1 },
  { question: "Which test file evaluates retrieval quality using the LoCoMo dataset?", evidence: ["file:src/storage/search.loco.test.ts"], category: 1 },
  { question: "What shell script creates a full backup of OpenCode configuration?", evidence: ["file:scripts/opencode-backup.sh"], category: 1 },
  { question: "What configuration file controls which preset the model router uses?", evidence: ["file:tiers.json"], category: 1 },
  { question: "Which module handles BM25 index refresh and incremental update?", evidence: ["file:src/storage/queries/bm25-index.ts"], category: 1 },
  { question: "What dataset types file defines CATEGORY_LABELS for numeric category mapping?", evidence: ["file:scripts/benchmark/datasets/locomo.ts"], category: 1 },
  { question: "What module wraps the ONNX runtime for embedding inference?", evidence: ["file:src/embeddings/onnx.ts"], category: 1 },
  { question: "What SQLite expression depth issue required using IN instead of OR in BM25 queries?", evidence: ["bug:sqlite-expression-depth-limit"], category: 1 },
  { question: "What was the root cause of the LoCoMo database contamination bug?", evidence: ["bug:locomo-db-contamination"], category: 1 },
  { question: "What bug causes the MemoryStore interface to miss temporalHops in its search options type?", evidence: ["bug:searchByEmbedding-type-mismatch"], category: 1 },
  { question: "What configuration change fixed the subagent API connection failure?", evidence: ["bug:model-router-connection"], category: 1 },
  { question: "What test runner should be used according to project preferences?", evidence: ["pref:testing"], category: 1 },
  { question: "What is the preferred embedding model for the project?", evidence: ["pref:embedding-model"], category: 1 },
  { question: "What database backend does the memory store use?", evidence: ["pref:database"], category: 1 },
  { question: "Why was BM25 scoring added alongside vector search?", evidence: ["decision:bm25-over-vector"], category: 1 },
  { question: "Why were local ONNX embeddings chosen over API-based alternatives?", evidence: ["decision:onnx-over-api"], category: 1 },
  { question: "What scoring approach combines vector similarity with keyword overlap?", evidence: ["concept:hybrid-search"], category: 1 },
  { question: "What process automatically inserts relevant memory into agent context?", evidence: ["concept:memory-injection"], category: 1 },
  { question: "What playbook describes how to regenerate the LoCoMo evaluation database?", evidence: ["playbook:re-seed-locomo"], category: 1 },

  // ── Paraphrase (25) ──
  { question: "Where is the code that merges embedding similarity with keyword-based BM25 scores?", evidence: ["file:src/storage/search.ts"], category: 2 },
  { question: "Which file contains the generateEmbedding function for turning text into vectors?", evidence: ["file:src/embeddings/index.ts"], category: 2 },
  { question: "Where is the factory that creates the SQLite-powered memory store given a path?", evidence: ["file:src/storage/sqlite.ts"], category: 2 },
  { question: "Which file resolved the BM1000 AST depth crash by switching query style?", evidence: ["file:src/storage/queries/search-helpers.ts"], category: 2 },
  { question: "Where does the plugin detect when a file cache summary has gone stale?", evidence: ["file:src/plugin/hooks.ts"], category: 2 },
  { question: "Which file provides the type definitions for memory nodes and the store interface?", evidence: ["file:src/storage/types.ts"], category: 2 },
  { question: "What script ingests the long-conversation benchmark into a searchable database?", evidence: ["file:scripts/seed-loco-db.ts"], category: 2 },
  { question: "What test measures how well the search finds correct evidence across five question categories?", evidence: ["file:src/storage/search.loco.test.ts"], category: 2 },
  { question: "What tool archives opencode dot directories into a portable restoreable tarball?", evidence: ["file:scripts/opencode-backup.sh"], category: 2 },
  { question: "Which JSON file holds the router presets and the active preset selector?", evidence: ["file:tiers.json"], category: 2 },
  { question: "Where does the BM25 term frequency table get rebuilt from scratch?", evidence: ["file:src/storage/queries/bm25-index.ts"], category: 2 },
  { question: "Which dataset helper maps category numbers like 1 to names like single_hop?", evidence: ["file:scripts/benchmark/datasets/locomo.ts"], category: 2 },
  { question: "Which module loads the ONNX model and runs inference for vector generation?", evidence: ["file:src/embeddings/onnx.ts"], category: 2 },
  { question: "What issue required rewriting term matching SQL to avoid the expression tree limit?", evidence: ["bug:sqlite-expression-depth-limit"], category: 2 },
  { question: "Why did the first seed run pollute the real user database with evaluation data?", evidence: ["bug:locomo-db-contamination"], category: 2 },
  { question: "What interface limitation forces callers to cast search options to any?", evidence: ["bug:searchByEmbedding-type-mismatch"], category: 2 },
  { question: "What was wrong with tiers.json that prevented subagent API calls from working?", evidence: ["bug:model-router-connection"], category: 2 },
  { question: "Which test framework does the project standardize on?", evidence: ["pref:testing"], category: 2 },
  { question: "What vector dimension does the local sentence transformer produce?", evidence: ["pref:embedding-model"], category: 2 },
  { question: "What storage engine powers the memory plugin?", evidence: ["pref:database"], category: 2 },
  { question: "What motivated integrating keyword retrieval alongside dense vector search?", evidence: ["decision:bm25-over-vector"], category: 2 },
  { question: "What three factors drove the decision to embed locally rather than call an API?", evidence: ["decision:onnx-over-api"], category: 2 },
  { question: "What technique merges cosine similarity with term frequency scores for ranking?", evidence: ["concept:hybrid-search"], category: 2 },
  { question: "How does the system supply relevant context to the agent before tool execution?", evidence: ["concept:memory-injection"], category: 2 },
  { question: "What are the steps to refresh the LoCoMo benchmark database?", evidence: ["playbook:re-seed-locomo"], category: 2 },

  // ── Ambiguous (20) ──
  // Q matching search scoring → matches concept:hybrid-search AND file:src/storage/search.ts AND decision:bm25-over-vector
  { question: "How does the combined scoring work during retrieval?", evidence: ["concept:hybrid-search", "file:src/storage/search.ts", "decision:bm25-over-vector"], category: 3 },
  // Q matching database → matches pref:database AND file:src/storage/sqlite.ts
  { question: "What database engine does the memory system use and how is it configured?", evidence: ["pref:database", "file:src/storage/sqlite.ts"], category: 3 },
  // Q matching file summaries → matches concept:file-summary-cache AND file:src/plugin/hooks.ts
  { question: "How are file summaries cached and validated for freshness?", evidence: ["concept:file-summary-cache", "file:src/plugin/hooks.ts"], category: 3 },
  // Q matching embeddings → matches pref:embedding-model AND decision:onnx-over-api AND file:src/embeddings/index.ts
  { question: "What embedding setup does this project use and why?", evidence: ["pref:embedding-model", "decision:onnx-over-api", "file:src/embeddings/index.ts"], category: 3 },
  // Q matching temporal edges → matches concept:temporal-edges AND decision:temporal-expansion
  { question: "How does temporal context expansion work in the search?", evidence: ["concept:temporal-edges", "decision:temporal-expansion"], category: 3 },
  // Q matching BM25 → matches concept:bm25-scoring AND concept:hybrid-search AND file:src/storage/queries/bm25-index.ts
  { question: "How does BM25 contribute to the retrieval pipeline?", evidence: ["concept:bm25-scoring", "concept:hybrid-search", "file:src/storage/queries/bm25-index.ts"], category: 3 },
  // Q matching LoCoMo test → matches file:src/storage/search.loco.test.ts AND session:locomo-initial-results
  { question: "What were the LoCoMo evaluation results?", evidence: ["file:src/storage/search.loco.test.ts", "session:locomo-initial-results"], category: 3 },
  // Q matching seed → matches file:scripts/seed-loco-db.ts AND playbook:re-seed-locomo
  { question: "How do I regenerate the evaluation database?", evidence: ["file:scripts/seed-loco-db.ts", "playbook:re-seed-locomo"], category: 3 },
  // Q matching model-router bug → matches bug:model-router-connection AND session:model-router-fix
  { question: "What was wrong with the model router configuration?", evidence: ["bug:model-router-connection", "session:model-router-fix"], category: 3 },
  // Q matching HNSW → matches decision:hnsw-over-flat AND concept:hybrid-search
  { question: "What index does the vector search use and why?", evidence: ["decision:hnsw-over-flat", "concept:hybrid-search"], category: 3 },
  // Q matching cache staleness → matches bug:file-cache-staleness AND session:mtime-staleness-implementation
  { question: "How does the system detect when a file summary is outdated?", evidence: ["bug:file-cache-staleness", "session:mtime-staleness-implementation", "file:src/plugin/hooks.ts"], category: 3 },
  // Q matching LoCoMo issues → matches session:locomo-audit-discovery AND session:locomo-initial-results
  { question: "What problems were discovered with the LoCoMo benchmark data?", evidence: ["session:locomo-audit-discovery", "session:locomo-initial-results"], category: 3 },
  // Q matching memory injection → matches concept:memory-injection AND file:src/plugin/hooks.ts
  { question: "How does the agent get relevant memory context before responding?", evidence: ["concept:memory-injection", "file:src/plugin/hooks.ts"], category: 3 },
  // Q matching database pollution → matches bug:locomo-db-contamination AND session:database-pollution
  { question: "How did evaluation data end up in the real memory database?", evidence: ["bug:locomo-db-contamination", "session:database-pollution"], category: 3 },
  // Q matching backup → matches file:scripts/opencode-backup.sh AND session:backup-script
  { question: "How do I create a complete OpenCode configuration backup?", evidence: ["file:scripts/opencode-backup.sh", "session:backup-script"], category: 3 },
  // Q matching fractal memory → matches concept:fractal-memory AND decision:hnsw-over-flat (these are different levels but the query is ambiguous)
  { question: "How is memory organized for efficient retrieval?", evidence: ["concept:fractal-memory", "concept:hybrid-search"], category: 3 },
  // Q matching QA pairs → matches file:scripts/benchmark/datasets/locomo.ts AND file:src/storage/search.loco.test.ts
  { question: "How are QA categories labeled in the dataset definitions?", evidence: ["file:scripts/benchmark/datasets/locomo.ts", "file:src/storage/search.loco.test.ts"], category: 3 },
  // Q matching search tweaks → matches session:search-tweak-experiments AND bug:test-timeout-temporal-expansion
  { question: "Did the search configuration changes improve retrieval quality?", evidence: ["session:search-tweak-experiments", "bug:test-timeout-temporal-expansion"], category: 3 },
  // Q matching code style → matches pref:code-style AND pref:testing
  { question: "What are the coding conventions for this project?", evidence: ["pref:code-style", "pref:testing"], category: 3 },
  // Q matching git → matches pref:git-practices AND bug:git-credentials-missing
  { question: "How should I handle git commits in this environment?", evidence: ["pref:git-practices", "bug:git-credentials-missing"], category: 3 },

  // ── Hard-negative (15): query is similar to a distractor but evidence is a DIFFERENT node ──
  // Query about BM25 weight → should find decision:bm25-over-vector, NOT concept:bm25-scoring (about formula, not weight config)
  { question: "What is the default BM25 weight in the hybrid score?", evidence: ["decision:bm25-over-vector"], category: 4 },
  // Query about embedding model name → should find pref:embedding-model, NOT file:src/embeddings/index.ts (about code, not model name)
  { question: "Which specific sentence transformer model does the project use?", evidence: ["pref:embedding-model"], category: 4 },
  // Query about ONNX runtime → should find file:src/embeddings/onnx.ts, NOT file:src/embeddings/index.ts (index.ts uses onnx.ts but is higher level)
  { question: "Which module directly manages the ONNX inference session lifecycle?", evidence: ["file:src/embeddings/onnx.ts"], category: 4 },
  // Query about search options type → should find bug:searchByEmbedding-type-mismatch, NOT file:src/storage/types.ts (types.ts has the interface, bug is about the gap)
  { question: "Why does the search function accept parameters that the TypeScript interface does not list?", evidence: ["bug:searchByEmbedding-type-mismatch"], category: 4 },
  // Query about WAL mode → should find decision:wal-mode, NOT pref:database (both mention SQLite, but WAL is a decision)
  { question: "Why does the memory database use WAL journal mode?", evidence: ["decision:wal-mode"], category: 4 },
  // Query about test runtime → should find bug:test-timeout-temporal-expansion, NOT session:search-tweak-experiments (session covers broader experiments)
  { question: "How much did temporal expansion slow down the LoCoMo test?", evidence: ["bug:test-timeout-temporal-expansion"], category: 4 },
  // Query about npm fix → should find bug:npm-vulnerability-fix, NOT any other bug
  { question: "What did npm audit fix resolve in the project dependencies?", evidence: ["bug:npm-vulnerability-fix"], category: 4 },
  // Query about git push → should find bug:git-credentials-missing, NOT pref:git-practices (pref covers commit style, bug covers the actual failure)
  { question: "Why does git push fail in the development environment?", evidence: ["bug:git-credentials-missing"], category: 4 },
  // Query about adding new data → should find playbook:add-evaluation-data, NOT playbook:seed-synthetic (different steps)
  { question: "What are the steps to add a new test case to the evaluation suite?", evidence: ["playbook:add-evaluation-data"], category: 4 },
  // Query about upgrading model → should find playbook:upgrade-embedding-model, NOT decision:onnx-over-api (decision is about why, playbook is about how)
  { question: "How do I upgrade to a different embedding model?", evidence: ["playbook:upgrade-embedding-model"], category: 4 },
  // Query about generating embeddings → should find file:src/embeddings/index.ts, NOT file:src/embeddings/onnx.ts (index.ts has the public API)
  { question: "What is the public API function for generating text embeddings?", evidence: ["file:src/embeddings/index.ts"], category: 4 },
  // Query about HNSW recall → should find decision:hnsw-over-flat, NOT concept:hybrid-search (different decisions)
  { question: "What recall level does the HNSW index achieve for the typical use case?", evidence: ["decision:hnsw-over-flat"], category: 4 },
  // Query about reranking → should find decision:rerank-keyword, NOT decision:bm25-over-vector (rerank is a separate step)
  { question: "What additional reranking step is applied after the hybrid score merge?", evidence: ["decision:rerank-keyword"], category: 4 },
  // Query about category filter → should find decision:category-filter-available, NOT bug:searchByEmbedding-type-mismatch (related but distinct)
  { question: "What filter parameters exist in the internal search function but not in the store interface?", evidence: ["decision:category-filter-available"], category: 4 },
  // Query about session summaries → should find concept:file-summary-cache, NOT file:src/plugin/hooks.ts (concept explains what, hooks.ts is the implementation)
  { question: "What naming pattern is used for file summary memory nodes?", evidence: ["concept:file-summary-cache"], category: 4 },

  // ── Temporal (10): requires following NEXT edges between conversation sessions ──
  // session:locomo-initial-results → NEXT → session:search-tweak-experiments
  { question: "After the first LoCoMo test run what experiments did the team try next?", evidence: ["session:locomo-initial-results", "session:search-tweak-experiments"], category: 5 },
  // session:search-tweak-experiments → NEXT → session:database-pollution
  { question: "Following the search tweak experiments what operational issue occurred?", evidence: ["session:search-tweak-experiments", "session:database-pollution"], category: 5 },
  // session:database-pollution → NEXT → session:model-router-fix
  { question: "After cleaning up the database contamination what connectivity problem surfaced?", evidence: ["session:database-pollution", "session:model-router-fix"], category: 5 },
  // session:locomo-initial-results → NEXT → session:locomo-audit-discovery
  { question: "What triggered the team to investigate LoCoMo dataset quality issues?", evidence: ["session:locomo-initial-results", "session:locomo-audit-discovery"], category: 5 },
  // session:locomo-audit-discovery → NEXT → session:synthetic-data-planning
  { question: "What did the team decide to do after discovering LoCoMo dataset problems?", evidence: ["session:locomo-audit-discovery", "session:synthetic-data-planning"], category: 5 },
  // session:model-router-fix → NEXT → session:backup-script
  { question: "After fixing the model router what infrastructure tool did the team create?", evidence: ["session:model-router-fix", "session:backup-script"], category: 5 },
  // Temporal chain: contamination → model-router-fix → backup
  { question: "Trace the sequence: after the database was contaminated what two issues followed?", evidence: ["session:database-pollution", "session:model-router-fix", "session:backup-script"], category: 5 },
  // Temporal chain: initial-results → audit → synthetic-planning
  { question: "How did the team go from first test results to planning a new synthetic dataset?", evidence: ["session:locomo-initial-results", "session:locomo-audit-discovery", "session:synthetic-data-planning"], category: 5 },
  // session:mtime-staleness-implementation → related to bug:file-cache-staleness (edge is semantic, not temporal)
  { question: "What implementation followed from identifying the file cache staleness bug?", evidence: ["bug:file-cache-staleness", "session:mtime-staleness-implementation"], category: 5 },
  // session:backup-script → NEXT → session:synthetic-data-planning (if we connect them)
  { question: "What planning work followed the backup script creation?", evidence: ["session:backup-script", "session:synthetic-data-planning"], category: 5 },

  // ── Adversarial (10): questions that sound plausible but have no answer in the dataset ──
  { question: "What OpenAI API key is configured for embedding generation?", evidence: [], category: 6 },
  { question: "Which MySQL connection string does the memory store use?", evidence: [], category: 6 },
  { question: "What is the Redis cache TTL for file summaries?", evidence: [], category: 6 },
  { question: "How do I configure the PostgreSQL replication lag threshold?", evidence: [], category: 6 },
  { question: "What Docker Compose file sets up the embedding service?", evidence: [], category: 6 },
  { question: "Which AWS Lambda function handles memory injection?", evidence: [], category: 6 },
  { question: "What is the Kubernetes deployment name for the ONNX model server?", evidence: [], category: 6 },
  { question: "How many GPU nodes are allocated for the HNSW index build?", evidence: [], category: 6 },
  { question: "What Kafka topic streams memory update events?", evidence: [], category: 6 },
  { question: "Which GraphQL endpoint exposes the memory search API?", evidence: [], category: 6 },

  // ── Batch 2: Direct (10) ──
  { question: "Where are the SQLite schema migration definitions stored?", evidence: ["file:src/storage/migrations/definitions.ts"], category: 1 },
  { question: "What function computes cosine similarity between embedding vectors?", evidence: ["file:src/math.ts"], category: 1 },
  { question: "What singleton manages the HNSW approximate nearest neighbor index?", evidence: ["file:src/hnsw-index.ts"], category: 1 },
  { question: "Which file implements the MCP protocol server for AI assistant integration?", evidence: ["file:src/mcp/server.ts"], category: 1 },
  { question: "Where does the project define default configuration values and environment mappings?", evidence: ["file:src/config.ts"], category: 1 },
  { question: "What bug causes the reranker to overflow the call stack on long content?", evidence: ["bug:stack-overflow-rerank"], category: 1 },
  { question: "What causes the HNSW index rebuild to crash with identical embedding vectors?", evidence: ["bug:hnsw-rebuild-crash"], category: 1 },
  { question: "What scoring formula combines vector similarity with BM25 and recency boost?", evidence: ["decision:importance-scoring"], category: 1 },
  { question: "How does the HNSW approximate nearest neighbor algorithm structure its graph?", evidence: ["concept:hnsw-index"], category: 1 },
  { question: "What session debugged the HNSW rebuild crash caused by duplicate embeddings?", evidence: ["session:hnsw-rebuild-issue"], category: 1 },

  // ── Batch 2: Paraphrase (10) ──
  { question: "Where can I find the database table schemas and migration definitions?", evidence: ["file:src/storage/migrations/definitions.ts"], category: 2 },
  { question: "Which module has the cosine distance calculation for vector comparison?", evidence: ["file:src/math.ts"], category: 2 },
  { question: "What provides the global HNSW index instance for nearest neighbor search queries?", evidence: ["file:src/hnsw-index.ts"], category: 2 },
  { question: "Where is the Model Context Protocol server that exposes memory tools to AI assistants?", evidence: ["file:src/mcp/server.ts"], category: 2 },
  { question: "Which file holds the environment variable mappings and default settings?", evidence: ["file:src/config.ts"], category: 2 },
  { question: "Why does the reranker crash with a stack exceeded error on large documents?", evidence: ["bug:stack-overflow-rerank"], category: 2 },
  { question: "What happens when two nodes have the exact same embedding in the HNSW graph?", evidence: ["bug:hnsw-rebuild-crash"], category: 2 },
  { question: "How is the final relevance score calculated from its different components?", evidence: ["decision:importance-scoring"], category: 2 },
  { question: "Describe the multi-layer graph structure used by the HNSW search algorithm", evidence: ["concept:hnsw-index"], category: 2 },
  { question: "Which session log covers the duplicate embedding crash investigation?", evidence: ["session:hnsw-rebuild-issue"], category: 2 },

  // ── Batch 2: Ambiguous (10) ──
  // HNSW → matches file:src/hnsw-index.ts AND concept:hnsw-index AND decision:hnsw-over-flat
  { question: "Tell me about the HNSW index implementation and why it was chosen", evidence: ["file:src/hnsw-index.ts", "concept:hnsw-index", "decision:hnsw-over-flat"], category: 3 },
  // Migrations → matches file:src/storage/migrations/definitions.ts AND concept:sqlite-migrations
  { question: "How are database schema migrations managed in this project?", evidence: ["file:src/storage/migrations/definitions.ts", "concept:sqlite-migrations"], category: 3 },
  // Score decay → matches concept:score-decay AND session:score-decay-tuning AND decision:importance-scoring
  { question: "How does the memory system decide which information to keep and which to forget?", evidence: ["concept:score-decay", "session:score-decay-tuning", "decision:importance-scoring"], category: 3 },
  // Edge traversal → matches concept:edge-traversal AND concept:temporal-edges AND decision:temporal-expansion
  { question: "How does the search follow connections between related memory nodes?", evidence: ["concept:edge-traversal", "concept:temporal-edges", "decision:temporal-expansion"], category: 3 },
  // SQLite concurrency → matches bug:sqlite-busy-timeout AND session:sqlite-concurrency-fix AND decision:wal-mode
  { question: "How are concurrent database access issues handled in the memory plugin?", evidence: ["bug:sqlite-busy-timeout", "session:sqlite-concurrency-fix", "decision:wal-mode"], category: 3 },
  // Rerank → matches bug:stack-overflow-rerank AND session:rerank-performance AND decision:rerank-keyword
  { question: "What issues have been encountered with the keyword reranking step?", evidence: ["bug:stack-overflow-rerank", "session:rerank-performance", "decision:rerank-keyword"], category: 3 },
  // Zero vector search → matches bug:empty-embedding-search AND file:src/math.ts (vector math)
  { question: "What happens when a search query has no meaningful vector content?", evidence: ["bug:empty-embedding-search", "file:src/math.ts"], category: 3 },
  // Orphan edges → matches bug:edge-orphan-nodes AND concept:edge-traversal
  { question: "What cleanup issues exist with the temporal edge system?", evidence: ["bug:edge-orphan-nodes", "concept:edge-traversal"], category: 3 },
  // Retry logic → matches decision:retry-on-failure AND bug:sqlite-busy-timeout
  { question: "How does the system recover from transient database failures?", evidence: ["decision:retry-on-failure", "bug:sqlite-busy-timeout"], category: 3 },
  // Project isolation → matches decision:project-scope-isolation AND pref:database
  { question: "How are different projects' memory stores kept separate?", evidence: ["decision:project-scope-isolation", "pref:database"], category: 3 },

  // ── Batch 2: Hard-negative (10) ──
  // HNSW algorithm vs HNSW file → query about mult-layer graph should find concept:hnsw-index, NOT file:src/hnsw-index.ts
  { question: "Explain the multi-layer graph traversal strategy used for approximate nearest neighbor search", evidence: ["concept:hnsw-index"], category: 4 },
  // Cosine similarity function vs file   → query about vector comparison should find file:src/math.ts, NOT concept:hnsw-index
  { question: "Which function normalizes embedding vectors before similarity comparison?", evidence: ["file:src/math.ts"], category: 4 },
  // Migration file vs concept → query about version tracking should find concept:sqlite-migrations, NOT file:src/storage/migrations/definitions.ts
  { question: "What mechanism ensures the database schema stays compatible across code updates?", evidence: ["concept:sqlite-migrations"], category: 4 },
  // Rerank stack overflow vs rerank decision → query about long content should find bug:stack-overflow-rerank, NOT decision:rerank-keyword
  { question: "What specific error occurs when reranking very long document content?", evidence: ["bug:stack-overflow-rerank"], category: 4 },
  // Busy timeout vs concurrency session → query about timeout value should find bug:sqlite-busy-timeout, NOT session:sqlite-concurrency-fix
  { question: "What is the current busy timeout setting for the SQLite database?", evidence: ["bug:sqlite-busy-timeout"], category: 4 },
  // Zero vector search bug vs math module → query about empty queries should find bug:empty-embedding-search, NOT file:src/math.ts
  { question: "What fallback behavior occurs when a search query embedding is all zeros?", evidence: ["bug:empty-embedding-search"], category: 4 },
  // Retry vs concurrency → query about backoff algorithm should find decision:retry-on-failure, NOT bug:sqlite-busy-timeout
  { question: "What is the exponential backoff strategy for retrying failed database operations?", evidence: ["decision:retry-on-failure"], category: 4 },
  // Score decay concept vs session → query about calibration should find session:score-decay-tuning, NOT concept:score-decay
  { question: "What decay window was settled on after tuning the forgetting parameters?", evidence: ["session:score-decay-tuning"], category: 4 },
  // Seed strategy vs separate scripts → query about why seed is separate should find decision:memory-seed-strategy, NOT decision:seed-separate-from-test
  { question: "Why does the database seeding run as a separate script instead of being integrated into the test setup?", evidence: ["decision:memory-seed-strategy"], category: 4 },
  // Edge traversal vs temporal edges → query about expandWithTemporalContext should find concept:edge-traversal, NOT concept:temporal-edges
  { question: "Which function follows typed connections between nodes to retrieve contextually adjacent information?", evidence: ["concept:edge-traversal"], category: 4 },

  // ── Batch 2: Temporal (5) ──
  // session:hnsw-rebuild-issue → NEXT → session:sqlite-concurrency-fix
  { question: "After fixing the HNSW rebuild crash what concurrency issue needed attention next?", evidence: ["session:hnsw-rebuild-issue", "session:sqlite-concurrency-fix"], category: 5 },
  // session:sqlite-concurrency-fix → NEXT → session:rerank-performance
  { question: "What performance problem surfaced after the SQLite concurrency fix was deployed?", evidence: ["session:sqlite-concurrency-fix", "session:rerank-performance"], category: 5 },
  // session:rerank-performance → NEXT → session:score-decay-tuning
  { question: "After optimizing the reranker what system tuning was done next?", evidence: ["session:rerank-performance", "session:score-decay-tuning"], category: 5 },
  // Long chain through all 4 new sessions
  { question: "Trace the sequence of debugging efforts from the HNSW crash through to the decay tuning", evidence: ["session:hnsw-rebuild-issue", "session:sqlite-concurrency-fix", "session:rerank-performance", "session:score-decay-tuning"], category: 5 },
  // Cross-chain: new session → existing session bridge
  { question: "How did the HNSW rebuild bug relate to the earlier LoCoMo database contamination incident?", evidence: ["session:hnsw-rebuild-issue", "session:database-pollution"], category: 5 },

  // ── Batch 2: Adversarial (10) ──
  { question: "What is the MongoDB connection URI used by the memory store?", evidence: [], category: 6 },
  { question: "Which Elasticsearch index stores the memory node embeddings?", evidence: [], category: 6 },
  { question: "How do I configure the S3 bucket for database backups?", evidence: [], category: 6 },
  { question: "What Prometheus metrics endpoint exposes search latency data?", evidence: [], category: 6 },
  { question: "Which RabbitMQ queue receives memory injection events?", evidence: [], category: 6 },
  { question: "What Cloudflare Worker handles memory API requests from edge locations?", evidence: [], category: 6 },
  { question: "How do I enable the Cassandra replication factor for high availability?", evidence: [], category: 6 },
  { question: "What is the rate limit for the OpenAI embedding API used by this project?", evidence: [], category: 6 },
  { question: "Which Terraform module deploys the memory store infrastructure?", evidence: [], category: 6 },
  { question: "What is the Memcached TTL for cached memory query results?", evidence: [], category: 6 },

  // ── Batch 3: Multi-graph (15) ──
  // CAUSAL: bug → fix. SQLite depth limit → IN clause fix
  { question: "What fix resolved the SQLite expression tree depth limit in BM25 queries?", evidence: ["bug:sqlite-expression-depth-limit", "decision:bm25-in-clause"], category: 3 },
  // CAUSAL: bug → debug session. HNSW crash → investigation session
  { question: "How was the HNSW rebuild crash investigated and what was the root cause?", evidence: ["bug:hnsw-rebuild-crash", "session:hnsw-rebuild-issue"], category: 5 },
  // CAUSAL: bug → debug session. SQLite busy → concurrency fix
  { question: "How was the SQLite busy timeout issue diagnosed and resolved?", evidence: ["bug:sqlite-busy-timeout", "session:sqlite-concurrency-fix"], category: 5 },
  // CAUSAL: bug → fix. Rerank stack overflow → performance session
  { question: "What caused the reranker to crash on long content and how was it mitigated?", evidence: ["bug:stack-overflow-rerank", "session:rerank-performance"], category: 5 },
  // CAUSAL: bug → math module. Zero embedding search → fallback
  { question: "What happens when the search embedding is an empty zero vector and why?", evidence: ["bug:empty-embedding-search", "file:src/math.ts"], category: 3 },
  // CAUSAL: bug → concept. Orphan edges → edge traversal
  { question: "Why do dangling temporal edges occur and how are they related to edge traversal?", evidence: ["bug:edge-orphan-nodes", "concept:edge-traversal"], category: 3 },

  // RELATED_TO: concept ↔ decision
  { question: "How does the HNSW indexing choice relate to the nearest neighbor search requirements?", evidence: ["concept:hnsw-index", "decision:hnsw-over-flat"], category: 3 },
  // RELATED_TO: concept ↔ concept. BM25 → hybrid search
  { question: "How does BM25 scoring feed into the hybrid search scoring pipeline?", evidence: ["concept:bm25-scoring", "concept:hybrid-search"], category: 3 },
  // RELATED_TO: concept ↔ concept. Edge traversal → temporal edges
  { question: "How do edge traversal semantics connect to temporal edge structures?", evidence: ["concept:edge-traversal", "concept:temporal-edges"], category: 3 },
  // RELATED_TO: concept ↔ file. Migrations concept → definitions file
  { question: "Where are the SQLite schema migrations implemented and how do they relate to the migration strategy?", evidence: ["concept:sqlite-migrations", "file:src/storage/migrations/definitions.ts"], category: 3 },
  // RELATED_TO: file ↔ file. Search.ts → search-helpers.ts
  { question: "Which helper module does the main search function depend on for BM25 computation?", evidence: ["file:src/storage/search.ts", "file:src/storage/queries/search-helpers.ts"], category: 1 },
  // RELATED_TO: decision → concept. Importance scoring → score decay
  { question: "How does the importance scoring formula relate to the score decay mechanism?", evidence: ["decision:importance-scoring", "concept:score-decay"], category: 3 },

  // REFERENCES: session → file discussed
  { question: "What test file was referenced during the initial LoCoMo evaluation session?", evidence: ["session:locomo-initial-results", "file:src/storage/search.loco.test.ts"], category: 5 },
  // REFERENCES: session → file discussed. HNSW rebuild session → hnsw-index.ts
  { question: "Which source file did the team investigate during the HNSW rebuild debugging session?", evidence: ["session:hnsw-rebuild-issue", "file:src/hnsw-index.ts"], category: 5 },
  // REFERENCES: session → concept. Score decay tuning → score decay concept
  { question: "What concept was referenced during the score decay calibration session?", evidence: ["session:score-decay-tuning", "concept:score-decay"], category: 5 },
];

export const TEMPORAL_EDGES: TemporalEdgeDef[] = [
  { sourceLabel: "session:locomo-initial-results", targetLabel: "session:search-tweak-experiments", edgeType: "NEXT" },
  { sourceLabel: "session:search-tweak-experiments", targetLabel: "session:database-pollution", edgeType: "NEXT" },
  { sourceLabel: "session:database-pollution", targetLabel: "session:model-router-fix", edgeType: "NEXT" },
  { sourceLabel: "session:model-router-fix", targetLabel: "session:backup-script", edgeType: "NEXT" },
  { sourceLabel: "session:backup-script", targetLabel: "session:synthetic-data-planning", edgeType: "NEXT" },
  { sourceLabel: "session:locomo-initial-results", targetLabel: "session:locomo-audit-discovery", edgeType: "NEXT" },
  { sourceLabel: "session:locomo-audit-discovery", targetLabel: "session:synthetic-data-planning", edgeType: "NEXT" },
  { sourceLabel: "bug:file-cache-staleness", targetLabel: "session:mtime-staleness-implementation", edgeType: "NEXT" },
  { sourceLabel: "session:model-router-fix", targetLabel: "session:locomo-initial-results", edgeType: "NEXT" },
  { sourceLabel: "session:hnsw-rebuild-issue", targetLabel: "session:sqlite-concurrency-fix", edgeType: "NEXT" },
  { sourceLabel: "session:sqlite-concurrency-fix", targetLabel: "session:rerank-performance", edgeType: "NEXT" },
  { sourceLabel: "session:rerank-performance", targetLabel: "session:score-decay-tuning", edgeType: "NEXT" },
  { sourceLabel: "session:synthetic-data-planning", targetLabel: "session:hnsw-rebuild-issue", edgeType: "NEXT" },
  { sourceLabel: "bug:hnsw-rebuild-crash", targetLabel: "session:hnsw-rebuild-issue", edgeType: "NEXT" },
  { sourceLabel: "bug:sqlite-busy-timeout", targetLabel: "session:sqlite-concurrency-fix", edgeType: "NEXT" },
  { sourceLabel: "bug:stack-overflow-rerank", targetLabel: "session:rerank-performance", edgeType: "NEXT" },

  // ── CAUSAL edges (bug → fix/debug session) ──
  { sourceLabel: "bug:sqlite-expression-depth-limit", targetLabel: "decision:bm25-in-clause", edgeType: "CAUSAL" },
  { sourceLabel: "bug:file-cache-staleness", targetLabel: "session:mtime-staleness-implementation", edgeType: "CAUSAL" },
  { sourceLabel: "bug:hnsw-rebuild-crash", targetLabel: "session:hnsw-rebuild-issue", edgeType: "CAUSAL" },
  { sourceLabel: "bug:sqlite-busy-timeout", targetLabel: "session:sqlite-concurrency-fix", edgeType: "CAUSAL" },
  { sourceLabel: "bug:stack-overflow-rerank", targetLabel: "session:rerank-performance", edgeType: "CAUSAL" },
  { sourceLabel: "bug:empty-embedding-search", targetLabel: "file:src/math.ts", edgeType: "CAUSAL" },
  { sourceLabel: "bug:edge-orphan-nodes", targetLabel: "concept:edge-traversal", edgeType: "CAUSAL" },

  // ── RELATED_TO edges (concept ↔ concept, concept ↔ decision) ──
  { sourceLabel: "concept:hybrid-search", targetLabel: "decision:bm25-over-vector", edgeType: "RELATED_TO" },
  { sourceLabel: "concept:hnsw-index", targetLabel: "decision:hnsw-over-flat", edgeType: "RELATED_TO" },
  { sourceLabel: "concept:temporal-edges", targetLabel: "decision:temporal-expansion", edgeType: "RELATED_TO" },
  { sourceLabel: "concept:edge-traversal", targetLabel: "concept:temporal-edges", edgeType: "RELATED_TO" },
  { sourceLabel: "concept:bm25-scoring", targetLabel: "concept:hybrid-search", edgeType: "RELATED_TO" },
  { sourceLabel: "concept:sqlite-migrations", targetLabel: "file:src/storage/migrations/definitions.ts", edgeType: "RELATED_TO" },
  { sourceLabel: "concept:file-summary-cache", targetLabel: "file:src/plugin/hooks.ts", edgeType: "RELATED_TO" },
  { sourceLabel: "decision:importance-scoring", targetLabel: "concept:score-decay", edgeType: "RELATED_TO" },
  { sourceLabel: "file:src/storage/search.ts", targetLabel: "file:src/storage/queries/search-helpers.ts", edgeType: "RELATED_TO" },

  // ── REFERENCES edges (session → file discussed) ──
  { sourceLabel: "session:locomo-initial-results", targetLabel: "file:src/storage/search.loco.test.ts", edgeType: "REFERENCES" },
  { sourceLabel: "session:hnsw-rebuild-issue", targetLabel: "file:src/hnsw-index.ts", edgeType: "REFERENCES" },
  { sourceLabel: "session:sqlite-concurrency-fix", targetLabel: "file:src/storage/sqlite.ts", edgeType: "REFERENCES" },
  { sourceLabel: "session:rerank-performance", targetLabel: "file:src/storage/queries/search-helpers.ts", edgeType: "REFERENCES" },
  { sourceLabel: "session:score-decay-tuning", targetLabel: "concept:score-decay", edgeType: "REFERENCES" },
  { sourceLabel: "session:backup-script", targetLabel: "file:scripts/opencode-backup.sh", edgeType: "REFERENCES" },
];
