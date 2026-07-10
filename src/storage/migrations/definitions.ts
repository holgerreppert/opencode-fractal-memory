import { Database } from "bun:sqlite";

const SUPERTYPE_BACKFILL: Record<string, string> = {
  concept: "declarative",
  fact: "declarative",
  knowledge: "declarative",
  architecture: "declarative",
  convention: "declarative",
  research: "declarative",
  lesson: "procedural",
  howto: "procedural",
  skill: "procedural",
  playbook: "procedural",
  event: "experiential",
  note: "experiential",
  session: "experiential",
  task: "experiential",
  plan: "experiential",
  exploration: "experiential",
  "debug-investigation": "experiential",
  improvement: "experiential",
  review: "experiential",
  bug: "experiential",
  summary: "meta",
  core: "meta",
  fix: "meta",
};

export type Migration = {
  version: number;
  name: string;
  up: (db: Database) => void;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "create-table",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_nodes (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          label TEXT NOT NULL,
          content TEXT NOT NULL,
          summary TEXT,
          level INT NOT NULL DEFAULT 0,
          parent_ids TEXT,
          embedding TEXT,
          created_at INT NOT NULL,
          updated_at INT NOT NULL,
          importance REAL DEFAULT 0.5,
          access_count INT DEFAULT 0,
          last_accessed INT,
          type TEXT,
          metadata TEXT
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_scope ON memory_nodes(scope)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_level ON memory_nodes(level)`);
      try {
        db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_parent ON memory_nodes(parent_ids)`);
      } catch { /* index might already exist */ }
    },
  },
  {
    version: 2,
    name: "add-parent-ids-embedding",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existingColumns = new Set(tableInfo.map(c => c.name));

        if (existingColumns.size > 0) {
          if (!existingColumns.has("parent_ids")) {
            db.run("ALTER TABLE memory_nodes ADD COLUMN parent_ids TEXT");
          }
          if (!existingColumns.has("embedding")) {
            db.run("ALTER TABLE memory_nodes ADD COLUMN embedding TEXT");
          }
        }
      } catch { /* table may not exist yet — v1 will create it */ }
    },
  },
  {
    version: 3,
    name: "add-config-table",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INT NOT NULL
        )
      `);

      const now = Date.now();

      db.run(
        "INSERT OR IGNORE INTO memory_config (key, value, updated_at) VALUES (?, ?, ?)",
        ["context_threshold", "0.8", now],
      );
      db.run(
        "INSERT OR IGNORE INTO memory_config (key, value, updated_at) VALUES (?, ?, ?)",
        ["context_limit", "128000", now],
      );
      db.run(
        "INSERT OR IGNORE INTO memory_config (key, value, updated_at) VALUES (?, ?, ?)",
        ["similarity_threshold", "0.3", now],
      );
    },
  },
  {
    version: 5,
    name: "add-usage-log-table",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_usage_log (
          id TEXT PRIMARY KEY,
          tool_name TEXT NOT NULL,
          timestamp INT NOT NULL,
          result_tokens INT DEFAULT 0,
          context_warning INT DEFAULT 0,
          success INT DEFAULT 1,
          duration_ms INT DEFAULT 0
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_usage_log_tool ON memory_usage_log(tool_name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_usage_log_ts ON memory_usage_log(timestamp)`);
    },
  },
  {
    version: 6,
    name: "add-sticky-column",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existingColumns = new Set(tableInfo.map(c => c.name));

        if (existingColumns.size > 0 && !existingColumns.has("sticky")) {
          db.run("ALTER TABLE memory_nodes ADD COLUMN sticky INT DEFAULT 0");
        }
      } catch { /* table may not exist yet — v1 will create it */ }
    },
  },
  {
    version: 7,
    name: "add-confidence-tracking",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existingColumns = new Set(tableInfo.map(c => c.name));

        if (existingColumns.size > 0) {
          if (!existingColumns.has("confidence")) {
            db.run("ALTER TABLE memory_nodes ADD COLUMN confidence REAL DEFAULT 0.5");
          }
          if (!existingColumns.has("last_verified")) {
            db.run("ALTER TABLE memory_nodes ADD COLUMN last_verified INT");
          }
        }
      } catch { /* table may not exist yet — v1 will create it */ }
    },
  },
  {
    version: 8,
    name: "add-memory-links",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_links (
          source_id TEXT NOT NULL,
          target_label TEXT NOT NULL,
          target_id TEXT,
          PRIMARY KEY (source_id, target_label)
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_label)`);
    },
  },
  {
    version: 9,
    name: "add-binary-embeddings-and-bm25-index",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existingColumns = new Set(tableInfo.map(c => c.name));

        if (existingColumns.size > 0 && !existingColumns.has("embedding_blob")) {
          db.run("ALTER TABLE memory_nodes ADD COLUMN embedding_blob BLOB");
        }
      } catch { /* table may not exist yet */ }

      db.run(`
        CREATE TABLE IF NOT EXISTS bm25_index (
          term TEXT NOT NULL,
          node_id TEXT NOT NULL,
          frequency INT NOT NULL DEFAULT 1,
          scope TEXT NOT NULL,
          PRIMARY KEY (term, node_id)
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_bm25_term ON bm25_index(term)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_bm25_node ON bm25_index(node_id)`);

      db.run(`
        CREATE TABLE IF NOT EXISTS bm25_doc_stats (
          node_id TEXT PRIMARY KEY,
          token_count INT NOT NULL DEFAULT 0,
          scope TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 10,
    name: "add-injection-metrics",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS injection_metrics (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          timestamp INT NOT NULL,
          injected_node_count INT NOT NULL DEFAULT 0,
          injected_tokens INT NOT NULL DEFAULT 0,
          injection_mode TEXT,
          query_text TEXT,
          tool_calls INT NOT NULL DEFAULT 0,
          memory_tools_used TEXT,
          referenced_nodes TEXT,
          effectiveness_score REAL,
          task_description TEXT
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_injection_session ON injection_metrics(session_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_injection_ts ON injection_metrics(timestamp)`);
    },
  },
  {
    version: 12,
    name: "add-tool-call-duration",
    up: (db) => {
      try {
        db.run(`ALTER TABLE agent_tool_calls ADD COLUMN duration_ms REAL`);
      } catch  {
        // Column may already exist
      }
    },
  },
  {
    version: 13,
    name: "add-injection-feedback",
    up: (db) => {
      try {
        db.run(`ALTER TABLE injection_metrics ADD COLUMN injection_upvotes INT DEFAULT 0`);
        db.run(`ALTER TABLE injection_metrics ADD COLUMN injection_downvotes INT DEFAULT 0`);
        db.run(`ALTER TABLE injection_metrics ADD COLUMN task_outcome TEXT`);
        db.run(`ALTER TABLE injection_metrics ADD COLUMN needed_nodes TEXT`);
      } catch  {
        // Columns may already exist
      }
    },
  },
  {
    version: 14,
    name: "add-agent-tool-tracking",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS agent_tool_calls (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          timestamp INT NOT NULL,
          tool_name TEXT NOT NULL,
          args_json TEXT,
          output_preview TEXT,
          success INTEGER,
          duration_ms INTEGER,
          tool_category TEXT,
          file_path TEXT,
          command TEXT
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tool_session ON agent_tool_calls(session_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tool_name ON agent_tool_calls(tool_name)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_tool_ts ON agent_tool_calls(timestamp)`);

      db.run(`
        CREATE TABLE IF NOT EXISTS session_metrics (
          session_id TEXT PRIMARY KEY,
          started_at INT NOT NULL,
          ended_at INT,
          total_tool_calls INT DEFAULT 0,
          file_reads INT DEFAULT 0,
          file_edits INT DEFAULT 0,
          bash_commands INT DEFAULT 0,
          memory_tools INT DEFAULT 0,
          failed_tools INT DEFAULT 0,
          unique_files_touched TEXT,
          injection_count INT DEFAULT 0,
          injected_tokens INT DEFAULT 0,
          task_description TEXT,
          status TEXT DEFAULT 'active'
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_session_started ON session_metrics(started_at)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_session_status ON session_metrics(status)`);
    },
  },
  {
    version: 16,
    name: "add-pending-injections",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS pending_injections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          node_id TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'global',
          source TEXT DEFAULT 'management',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          processed INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_pending_injections_processed ON pending_injections(processed)`);
    },
  },
  {
    version: 15,
    name: "add-usefulness-scores",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existingColumns = new Set(tableInfo.map(c => c.name));

        if (existingColumns.size > 0) {
          if (!existingColumns.has("usefulness_score")) {
            db.run("ALTER TABLE memory_nodes ADD COLUMN usefulness_score REAL DEFAULT 0");
          }
          if (!existingColumns.has("times_used")) {
            db.run("ALTER TABLE memory_nodes ADD COLUMN times_used INT DEFAULT 0");
          }
          if (!existingColumns.has("times_helpful")) {
            db.run("ALTER TABLE memory_nodes ADD COLUMN times_helpful INT DEFAULT 0");
          }
        }
      } catch { /* table may not exist yet */ }
    },
  },
  {
    version: 17,
    name: "add-composite-index",
    up: (db) => {
      db.run("CREATE INDEX IF NOT EXISTS idx_nodes_scope_level_importance_created ON memory_nodes(scope, level, importance DESC, created_at DESC)");
    },
  },
  {
    version: 18,
    name: "add-playbooks",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS playbooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'project',
          steps TEXT NOT NULL,
          triggers TEXT NOT NULL DEFAULT '[]',
          execution_count INT NOT NULL DEFAULT 0,
          avg_duration_ms REAL,
          last_executed_at INT,
          created_at INT NOT NULL,
          updated_at INT NOT NULL,
          source_session_id TEXT,
          tags TEXT NOT NULL DEFAULT '[]'
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_playbooks_scope ON playbooks(scope)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_playbooks_name ON playbooks(name)`);

      db.run(`
        CREATE TABLE IF NOT EXISTS playbook_steps (
          id TEXT PRIMARY KEY,
          playbook_id TEXT NOT NULL,
          step_index INT NOT NULL,
          tool_name TEXT NOT NULL,
          description TEXT NOT NULL,
          params TEXT NOT NULL DEFAULT '{}',
          expected_outcome TEXT,
          critical INT NOT NULL DEFAULT 0,
          FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE CASCADE
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_playbook_steps_pb ON playbook_steps(playbook_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_playbook_steps_tool ON playbook_steps(tool_name)`);
    },
  },
  {
    version: 19,
    name: "add-ttl",
    up: (db) => {
      try {
        db.run("ALTER TABLE memory_nodes ADD COLUMN ttl_days INT");
      } catch { /* column may already exist */ }
      try {
        db.run("ALTER TABLE memory_nodes ADD COLUMN expires_at INT");
      } catch { /* column may already exist */ }
    },
  },
  {
    version: 20,
    name: "add-duration-ms",
    up: (db) => {
      try {
        db.run("ALTER TABLE memory_usage_log ADD COLUMN duration_ms INT DEFAULT 0");
      } catch { /* column may already exist */ }
    },
  },
  {
    version: 21,
    name: "add-project-name",
    up: (db) => {
      try {
        db.run("ALTER TABLE memory_nodes ADD COLUMN project_name TEXT");
      } catch { /* column may already exist */ }
      try {
        db.run("ALTER TABLE bm25_index ADD COLUMN project_name TEXT");
      } catch { /* column may already exist */ }
      try {
        db.run("ALTER TABLE bm25_doc_stats ADD COLUMN project_name TEXT");
      } catch { /* column may already exist */ }
      try {
        db.run("ALTER TABLE playbooks ADD COLUMN project_name TEXT");
      } catch { /* column may already exist */ }
    },
  },
  {
    version: 22,
    name: "add-temporal-edges",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS temporal_edges (
          id TEXT PRIMARY KEY,
          source_node_id TEXT NOT NULL,
          target_node_id TEXT NOT NULL,
          edge_type TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'project',
          created_at INT NOT NULL,
          confidence REAL DEFAULT 1.0,
          metadata TEXT
        )
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_temp_edges_source ON temporal_edges(source_node_id)");
      db.run("CREATE INDEX IF NOT EXISTS idx_temp_edges_target ON temporal_edges(target_node_id)");
      db.run("CREATE INDEX IF NOT EXISTS idx_temp_edges_type ON temporal_edges(edge_type)");
      db.run("CREATE INDEX IF NOT EXISTS idx_temp_edges_scope ON temporal_edges(scope)");
    },
  },
  {
    version: 23,
    name: "add-category-column",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existingColumns = new Set(tableInfo.map(c => c.name));
        if (!existingColumns.has("category")) {
          db.run("ALTER TABLE memory_nodes ADD COLUMN category TEXT");
          db.run("CREATE INDEX IF NOT EXISTS idx_nodes_category ON memory_nodes(category)");
        }
      } catch { /* table may not exist yet */ }
    },
  },
  {
    version: 24,
    name: "add-injection-quality-columns",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(injection_metrics)").all() as { name: string }[];
        const existing = new Set(tableInfo.map(c => c.name));
        if (!existing.has("pre_rerank_ids")) db.run("ALTER TABLE injection_metrics ADD COLUMN pre_rerank_ids TEXT");
        if (!existing.has("post_rerank_ids")) db.run("ALTER TABLE injection_metrics ADD COLUMN post_rerank_ids TEXT");
        if (!existing.has("rerank_scores")) db.run("ALTER TABLE injection_metrics ADD COLUMN rerank_scores TEXT");
        if (!existing.has("rerank_strategy")) db.run("ALTER TABLE injection_metrics ADD COLUMN rerank_strategy TEXT");
        if (!existing.has("rerank_duration_ms")) db.run("ALTER TABLE injection_metrics ADD COLUMN rerank_duration_ms REAL");
        if (!existing.has("injected_node_types")) db.run("ALTER TABLE injection_metrics ADD COLUMN injected_node_types TEXT");
        if (!existing.has("active_type_boosts")) db.run("ALTER TABLE injection_metrics ADD COLUMN active_type_boosts TEXT");
      } catch { /* table may not exist yet */ }
    },
  },
  {
    version: 25,
    name: "add-compression-stats",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS compression_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          timestamp INT NOT NULL,
          command TEXT NOT NULL,
          strategy TEXT,
          original_chars INT NOT NULL,
          compressed_chars INT NOT NULL,
          savings_ratio REAL NOT NULL,
          duration_ms REAL
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_compress_ts ON compression_stats(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_compress_cmd ON compression_stats(command)`);
    },
  },
  {
    version: 26,
    name: "add-compression-lines",
    up: (db) => {
      const tableInfo = db.query("PRAGMA table_info(compression_stats)").all() as { name: string }[];
      const existing = new Set(tableInfo.map(c => c.name));
      if (!existing.has("original_lines")) db.run("ALTER TABLE compression_stats ADD COLUMN original_lines INT");
      if (!existing.has("compressed_lines")) db.run("ALTER TABLE compression_stats ADD COLUMN compressed_lines INT");
      if (!existing.has("cmd_preview")) db.run("ALTER TABLE compression_stats ADD COLUMN cmd_preview TEXT");
    },
  },
  {
    version: 27,
    name: "add-compression-previews",
    up: (db) => {
      const tableInfo = db.query("PRAGMA table_info(compression_stats)").all() as { name: string }[];
      const existing = new Set(tableInfo.map(c => c.name));
      if (!existing.has("original_preview")) db.run("ALTER TABLE compression_stats ADD COLUMN original_preview TEXT");
      if (!existing.has("compressed_preview")) db.run("ALTER TABLE compression_stats ADD COLUMN compressed_preview TEXT");
    },
  },
  {
    version: 28,
    name: "add-token-tracking",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS token_tracking (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          timestamp INT NOT NULL,
          input_tokens INT DEFAULT 0,
          output_tokens INT DEFAULT 0,
          reasoning_tokens INT DEFAULT 0,
          cache_read_tokens INT DEFAULT 0,
          cache_write_tokens INT DEFAULT 0,
          cost REAL DEFAULT 0,
          turn_index INT DEFAULT 0,
          agent TEXT,
          model TEXT
        )
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_token_session ON token_tracking(session_id)");
      db.run("CREATE INDEX IF NOT EXISTS idx_token_ts ON token_tracking(timestamp)");
    },
  },
  {
    version: 29,
    name: "add-supertype-column",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existing = new Set(tableInfo.map(c => c.name));
        if (!existing.has("supertype")) {
          db.run("ALTER TABLE memory_nodes ADD COLUMN supertype TEXT");
          db.run("CREATE INDEX IF NOT EXISTS idx_nodes_supertype ON memory_nodes(supertype)");
        }
        // Backfill supertype for existing nodes where type is known
        const untyped = db.query("SELECT id, type FROM memory_nodes WHERE supertype IS NULL AND type IS NOT NULL").all() as { id: string; type: string }[];
        for (const row of untyped) {
          const supertype = SUPERTYPE_BACKFILL[row.type] ?? null;
          if (supertype) {
            db.run("UPDATE memory_nodes SET supertype = ? WHERE id = ?", [supertype, row.id]);
          }
        }
      } catch { /* table may not exist yet */ }
    },
  },
  {
    version: 30,
    name: "add-tags-source-verification",
    up: (db) => {
      try {
        const tableInfo = db.query("PRAGMA table_info(memory_nodes)").all() as { name: string }[];
        const existing = new Set(tableInfo.map(c => c.name));
        if (!existing.has("tags")) {
          db.run("ALTER TABLE memory_nodes ADD COLUMN tags TEXT");
        }
        if (!existing.has("source")) {
          db.run("ALTER TABLE memory_nodes ADD COLUMN source TEXT");
        }
        if (!existing.has("verification_count")) {
          db.run("ALTER TABLE memory_nodes ADD COLUMN verification_count INTEGER DEFAULT 0");
        }
      } catch { /* table may not exist yet */ }
    },
  },
];
