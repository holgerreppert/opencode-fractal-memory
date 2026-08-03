import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";

import { runMigrations } from "./migrations";
import { getHNSWIndex } from "../infrastructure/vector/hnsw-index";
import { type SqliteNode } from "./queries/base";
import { tokenize, extractLinks, embeddingToBlob, blobToEmbedding, withRetry, withRetryableTransaction } from "./utils";
export { extractLinks, embeddingToBlob, blobToEmbedding, tokenize, withRetry, withRetryableTransaction };
import type { MemoryNode, MemoryScope, MemoryNodeLevel, MemoryNodeType, MemoryCategory, SearchIntent, CreateNodeInput, FractalStats, FractalRetrievalResult } from "./types";
import type { MemoryStore } from "../domain/ports/MemoryStore";
import { queryListNodes, queryGetNodeByLabel, queryGetNodeByLabelFull, queryGetNodeByPrefix, queryCreateNode, queryUpdateNode, queryDeleteNode, querySearchText, querySearchBM25 } from "./queries/nodes";
import { queryStoreLinks, queryUpdateLinksForNewNode, queryGetLinks, queryDeleteLinks } from "./queries/links";
import { queryCreateTemporalEdge, queryGetTemporalEdges, queryExpandWithTemporalEdges, queryDeleteTemporalEdgesForNode } from "./queries/temporal-edges";
import { updateBM25Index, removeBM25Index } from "./queries/search-helpers";
import { CompressionHelper, COMPRESSION_LEVELS } from "./summarization";
export { CompressionHelper, COMPRESSION_LEVELS };
import { memLog } from "../logging";
import { getExpiredNodes as getExpiredNodesFn, deleteExpiredNodes as deleteExpiredNodesFn, pruneNodes as pruneNodesFn } from "./expiration";
import { backfillLinks as backfillLinksFn, backfillBinaryEmbeddingsAndBM25 as backfillBinaryEmbeddingsAndBM25Fn, backfillSupertype as backfillSupertypeFn, rebuildHNSWIndex as rebuildHNSWIndexFn } from "./maintenance";
import { searchByEmbedding as searchByEmbeddingFn, detectTopicBoundaries as detectTopicBoundariesFn, drilldownQuery as drilldownQueryFn, getDrilldownPath as getDrilldownPathFn } from "./search";
import { retrieveFractal as retrieveFractalFn, getFractalStats as getFractalStatsFn } from "./navigation";
import { getCompressionCandidates as getCompressionCandidatesFn, runCompression as runCompressionFn, runPatternExtraction as runPatternExtractionFn } from "./compress-ops";
import { ensureSeed as ensureSeedFn, resolveNode as resolveNodeFn, getNode as getNodeFn, verifyNode as verifyNodeFn } from "./lifecycle";
import { runScoreDecay as runScoreDecayFn, calculateNodeConfidence as calculateNodeConfidenceFn } from "./scoring";

import { SqliteSessionTracker } from "../infrastructure/persistence/sqlite/SqliteSessionTracker";
import { SqliteCompressionStore } from "../infrastructure/persistence/sqlite/SqliteCompressionStore";
import { SqliteConfigStore } from "../infrastructure/persistence/sqlite/SqliteConfigStore";
import { SqliteInjectionStore } from "../infrastructure/persistence/sqlite/SqliteInjectionStore";
import { SqliteLiveFeedStore } from "../infrastructure/persistence/sqlite/SqliteLiveFeedStore";

export type { MemoryScope, MemoryNodeLevel, MemoryNode, MemoryNodeType, MemoryCategory, CreateNodeInput, FractalStats, FractalRetrievalResult, DrilldownResult, MemoryStore } from "./types";

const SEED_BLOCKS: Array<{ scope: MemoryScope; label: string }> = [
  { scope: "global", label: "persona" },
  { scope: "global", label: "human" },
  { scope: "project", label: "project" },
];

function scopeDbPath(_projectDirectory: string, _scope: MemoryScope, globalDbPath?: string): string {
  return globalDbPath ?? path.join(os.homedir(), ".config", "opencode", "memory.db");
}

class SqliteMemoryStore implements MemoryStore {
  private dbs: Map<string, Database> = new Map();
  private dbInitPromises: Map<string, Promise<Database>> = new Map();
  private idScopeCache: Map<string, MemoryScope> = new Map();
  private projectDirectory: string;
  private globalDbPath: string | undefined;
  private _projectName: string;

  private sessionTracker: SqliteSessionTracker;
  private compressionStore: SqliteCompressionStore;
  private configStore: SqliteConfigStore;
  private injectionStore: SqliteInjectionStore;
  private liveFeedStore: SqliteLiveFeedStore;

  get projectName(): string {
    return this._projectName;
  }

  constructor(projectDirectory: string, globalDbPath?: string) {
    this.projectDirectory = projectDirectory;
    this.globalDbPath = globalDbPath;
    this._projectName = path.basename(projectDirectory);

    this.sessionTracker = new SqliteSessionTracker(() => this.getGlobalDb());
    this.compressionStore = new SqliteCompressionStore(() => this.getGlobalDb());
    this.configStore = new SqliteConfigStore((s) => this.getDb(s));
    this.injectionStore = new SqliteInjectionStore(() => this.getGlobalDb());
    this.liveFeedStore = new SqliteLiveFeedStore(() => this.getGlobalDb());
  }

  private async getDb(_scope?: MemoryScope): Promise<Database> {
    const key = this.projectDirectory;
    if (this.dbs.has(key)) {
      return this.dbs.get(key)!;
    }

    const existing = this.dbInitPromises.get(key);
    if (existing) return existing;

    const promise = this.initDb(key);
    this.dbInitPromises.set(key, promise);

    try {
      const db = await promise;
      return db;
    } catch (err) {
      this.dbInitPromises.delete(key);
      throw err;
    }
  }

  private async initDb(key: string): Promise<Database> {
    const dbPath = scopeDbPath(this.projectDirectory, "global", this.globalDbPath);

    const dbDir = path.dirname(dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    const db = new Database(dbPath);

    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA busy_timeout = 5000");

    runMigrations(db);

    this.dbs.set(key, db);
    this.dbInitPromises.delete(key);
    return db;
  }

  private async getGlobalDb(): Promise<Database> {
    return this.getDb("global");
  }

  async close(): Promise<void> {
    for (const [key, db] of this.dbs) {
      try {
        db.close();
      } catch (error) {
        memLog("error", "storage", `Error closing database ${key}:`, { error });
      }
    }
    this.dbs.clear();
    this.idScopeCache.clear();
  }

  async runScoreDecay(decayDays: number): Promise<number> {
    return runScoreDecayFn((s) => this.getDb(s), decayDays);
  }

  async ensureSeed(): Promise<void> {
    return ensureSeedFn((s) => this.getDb(s), SEED_BLOCKS, this.projectName);
  }

  async migrateFromProjectDb(): Promise<number> {
    const unifiedDb = await this.getDb();
    const oldDbPath = path.join(this.projectDirectory, ".opencode", "memory.db");
    if (!existsSync(oldDbPath)) return 0;

    memLog("info", "storage", "Migrating project DB to unified storage", { path: oldDbPath, projectName: this.projectName });

    const oldDb = new Database(oldDbPath);
    let migrated = 0;

    try {
      const oldNodes = oldDb.query("SELECT * FROM memory_nodes").all() as SqliteNode[];
      for (const oldRow of oldNodes) {
        const existing = unifiedDb.query("SELECT id FROM memory_nodes WHERE id = ?").get(oldRow.id) as { id: string } | null;
        if (existing) continue;

        unifiedDb.run(
          `INSERT OR IGNORE INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, created_at, updated_at, importance, access_count, last_accessed, type, metadata, sticky, ttl_days, expires_at, confidence, last_verified, usefulness_score, times_used, times_helpful, project_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            oldRow.id, oldRow.scope, oldRow.label, oldRow.content,
            oldRow.summary, oldRow.level, oldRow.parent_ids,
            oldRow.embedding, oldRow.embedding_blob,
            oldRow.created_at, oldRow.updated_at, oldRow.importance,
            oldRow.access_count, oldRow.last_accessed, oldRow.type,
            oldRow.metadata, oldRow.sticky ?? 0,
            oldRow.ttl_days, oldRow.expires_at,
            oldRow.confidence ?? 0.5, oldRow.last_verified,
            oldRow.usefulness_score ?? 0, oldRow.times_used ?? 0,
            oldRow.times_helpful ?? 0, this.projectName,
          ],
        );

        const bm25Rows = oldDb.query("SELECT * FROM bm25_index WHERE node_id = ?").all(oldRow.id) as Array<{ term: string; node_id: string; frequency: number; scope: string }>;
        for (const bm25 of bm25Rows) {
          unifiedDb.run(
            "INSERT OR IGNORE INTO bm25_index (term, node_id, frequency, scope, project_name) VALUES (?, ?, ?, ?, ?)",
            [bm25.term, bm25.node_id, bm25.frequency, bm25.scope, this.projectName],
          );
        }

        const docStats = oldDb.query("SELECT * FROM bm25_doc_stats WHERE node_id = ?").get(oldRow.id) as { node_id: string; token_count: number; scope: string } | null;
        if (docStats) {
          unifiedDb.run(
            "INSERT OR IGNORE INTO bm25_doc_stats (node_id, token_count, scope, project_name) VALUES (?, ?, ?, ?)",
            [docStats.node_id, docStats.token_count, docStats.scope, this.projectName],
          );
        }

        migrated++;
      }

      const oldLinks = oldDb.query("SELECT * FROM memory_links").all() as Array<{ source_id: string; target_label: string; target_id: string | null }>;
      for (const link of oldLinks) {
        unifiedDb.run(
          "INSERT OR IGNORE INTO memory_links (source_id, target_label, target_id) VALUES (?, ?, ?)",
          [link.source_id, link.target_label, link.target_id],
        );
      }

      memLog("info", "storage", "Project DB migration complete", { migrated });
    } finally {
      oldDb.close();
    }

    return migrated;
  }

  async listNodes(scope: MemoryScope | "all", level?: MemoryNodeLevel, limit: number = 50, offset: number = 0, includeExpired?: boolean, projectName?: string, category?: MemoryCategory): Promise<MemoryNode[]> {
    const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];
    const nodes: MemoryNode[] = [];

    for (const s of scopes) {
      const db = await this.getDb(s);
      const projectFilter = projectName !== undefined && s === "project" ? projectName : undefined;
      const rows = await queryListNodes(db, s, level, limit, offset, includeExpired, projectFilter, category);
      nodes.push(...rows);
    }

    return nodes;
  }

  async getNode(id: string): Promise<MemoryNode> {
    return getNodeFn((s) => this.getDb(s), id);
  }

  async getNodeByLabel(scope: MemoryScope, label: string): Promise<MemoryNode> {
    const db = await this.getDb(scope);
    return queryGetNodeByLabelFull(db, scope, label, false);
  }

  async getNodeByPrefix(prefix: string): Promise<MemoryNode | null> {
    const node = await queryGetNodeByPrefix(await this.getDb("global"), prefix)
      ?? await queryGetNodeByPrefix(await this.getDb("project"), prefix);
    return node;
  }

  async createNode(node: CreateNodeInput): Promise<MemoryNode> {
    const db = await this.getDb(node.scope);
    const nodeWithProject = node.scope === "project" && !node.projectName
      ? { ...node, projectName: this.projectName }
      : node;

    return await withRetryableTransaction(db, async () => {
      return await queryCreateNode(
        db,
        nodeWithProject,
        (scope, id, content) => this.storeLinks(scope, id, content),
        (scope, label, id) => this.updateLinksForNewNode(scope, label, id),
        (db, id, content, label, scope) => updateBM25Index(db, id, content, label, scope)
      );
    });
  }

  async updateNode(id: string, updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "category" | "supertype" | "domain" | "tags" | "source" | "metadata" | "embedding" | "sticky" | "ttlDays" | "confidence" | "verificationCount" | "usefulnessScore" | "timesHelpful">>): Promise<void> {
    const { db, scope } = await resolveNodeFn((s) => this.getDb(s), this.idScopeCache, id);

    await withRetryableTransaction(db, async () => {
      await queryUpdateNode(db, id, updates);

      if (updates.content !== undefined) {
        await this.storeLinks(scope, id, updates.content);
        const labelRow = db.query("SELECT label FROM memory_nodes WHERE id = ?").get(id) as { label: string } | null;
        updateBM25Index(db, id, updates.content, labelRow?.label, scope);
      }
    });
  }

  async deleteNode(id: string): Promise<void> {
    const { db, scope } = await resolveNodeFn((s) => this.getDb(s), this.idScopeCache, id);

    await withRetryableTransaction(db, async () => {
      await queryDeleteNode(db, id);
      queryDeleteLinks(db, id);
      queryDeleteTemporalEdgesForNode(db, id);
      removeBM25Index(db, id);
    });

    this.idScopeCache.delete(id);

    const hnsw = getHNSWIndex();
    await hnsw.removeNode(scope, id);
  }

  async storeLinks(scope: MemoryScope, sourceId: string, content: string): Promise<void> {
    const db = await this.getDb(scope);
    await queryStoreLinks(db, sourceId, content, queryGetNodeByLabel);
  }

  async updateLinksForNewNode(scope: MemoryScope, label: string, nodeId: string): Promise<void> {
    const db = await this.getDb(scope);
    queryUpdateLinksForNewNode(db, label, nodeId);
  }

  async backfillLinks(scope: MemoryScope): Promise<void> {
    const db = await this.getDb(scope);
    return backfillLinksFn(db);
  }

  async getLinkedNodes(scope: MemoryScope, sourceId: string): Promise<MemoryNode[]> {
    const db = await this.getDb(scope);
    const rows = queryGetLinks(db, sourceId);

    const linkedNodes: MemoryNode[] = [];
    for (const row of rows) {
      if (row.target_id) {
        try {
          const node = await this.getNode(row.target_id);
          linkedNodes.push(node);
        } catch { /* Node was deleted */ }
      }
    }

    return linkedNodes;
  }

  async createTemporalEdge(
    sourceNodeId: string, targetNodeId: string, edgeType: string,
    scope?: string, confidence?: number, metadata?: Record<string, unknown> | null,
  ): Promise<import("./types").TemporalEdge> {
    const db = await this.getDb(scope as MemoryScope ?? "project");
    return queryCreateTemporalEdge(db, { sourceNodeId, targetNodeId, edgeType, scope, confidence, metadata });
  }

  async getTemporalEdges(
    nodeId: string, direction?: "outgoing" | "incoming" | "both", edgeType?: string, scope?: MemoryScope,
  ): Promise<import("./types").TemporalEdge[]> {
    const db = await this.getDb(scope ?? "project");
    return queryGetTemporalEdges(db, nodeId, direction, edgeType);
  }

  async expandWithTemporalContext(
    nodeIds: string[], maxHops?: number, edgeType?: string,
  ): Promise<string[]> {
    const db = await this.getDb("project");
    const expanded = queryExpandWithTemporalEdges(db, nodeIds, maxHops, edgeType);
    return [...expanded.keys()];
  }

  async backfillBinaryEmbeddingsAndBM25(scope: MemoryScope): Promise<void> {
    const db = await this.getDb(scope);
    return backfillBinaryEmbeddingsAndBM25Fn(db, scope);
  }

  async backfillSupertype(scope: MemoryScope): Promise<void> {
    const db = await this.getDb(scope);
    return backfillSupertypeFn(db);
  }

  async rebuildHNSWIndex(scope?: MemoryScope | "all"): Promise<void> {
    return rebuildHNSWIndexFn((s) => this.getDb(s), scope);
  }

  async searchByEmbedding(
    query: number[],
    limit: number = 5,
    options?: { minLevel?: MemoryNodeLevel | undefined; maxLevel?: MemoryNodeLevel | undefined; levelWeights?: Partial<Record<MemoryNodeLevel, number>> | undefined; rrfK?: number | undefined; queryText?: string | undefined; minUsefulness?: number | undefined; rerank?: boolean | undefined; bm25Scores?: Map<string, number> | undefined; projectName?: string | undefined; temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number } | undefined; temporalHops?: number | undefined; categoryFilter?: MemoryCategory | undefined; typeFilter?: MemoryNodeType | undefined; intent?: SearchIntent | undefined; tagsFilter?: string[] | undefined }
  ): Promise<MemoryNode[]> {
    return searchByEmbeddingFn((s) => this.getDb(s), query, limit, options);
  }

  async searchText(scope: MemoryScope | "all", query: string, limit: number = 100, projectName?: string): Promise<MemoryNode[]> {
    const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];
    const results: MemoryNode[] = [];
    for (const s of scopes) {
      const db = await this.getDb(s);
      results.push(...querySearchText(db, s, query, limit, projectName));
    }
    results.sort((a, b) => b.importance - a.importance);
    return results.slice(0, limit);
  }

  async searchBM25(scope: MemoryScope | "all", query: string, limit: number = 100, projectName?: string): Promise<MemoryNode[]> {
    const terms = query.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(t => t.length >= 2);
    if (terms.length === 0) return [];
    const scopes: MemoryScope[] = scope === "all" ? ["global", "project"] : [scope];
    const results: MemoryNode[] = [];
    for (const s of scopes) {
      const db = await this.getDb(s);
      results.push(...querySearchBM25(db, s, terms, limit, projectName));
    }
    results.sort((a, b) => b.importance - a.importance);
    return results.slice(0, limit);
  }

  async getCompressionCandidates(
    scope: MemoryScope | "all",
    level: MemoryNodeLevel,
    maxAgeMs?: number,
    force?: boolean,
    projectName?: string
  ): Promise<MemoryNode[]> {
    return getCompressionCandidatesFn((s) => this.getDb(s), scope, level, maxAgeMs, force, projectName);
  }

  async runCompression(
    scope: MemoryScope | "all",
    force?: boolean,
    client?: unknown,
    projectName?: string,
    sessionId?: string,
  ): Promise<{ compressed: number; created: number }> {
    return runCompressionFn({
      getCompressionCandidates: (s, l, maxAge, f) => this.getCompressionCandidates(s, l, maxAge, f, projectName),
      createNode: (node) => this.createNode(node),
      updateNode: (id, updates) => this.updateNode(id, updates),
    }, scope, force, client, sessionId);
  }

  async runPatternExtraction(
    scope: MemoryScope | "all",
    minSourceCount: number = 2,
    projectName?: string
  ): Promise<{ created: number; sources: number }> {
    return runPatternExtractionFn({
      listNodes: (s, level, limit, offset, includeExpired) => this.listNodes(s, level, limit, offset, includeExpired, projectName),
      createNode: (node) => this.createNode(node),
      updateNode: (id, updates) => this.updateNode(id, updates),
    }, scope, minSourceCount);
  }

  async getFractalStats(scope: MemoryScope | "all", projectName?: string): Promise<FractalStats> {
    return getFractalStatsFn(
      (s) => this.listNodes(s, undefined, undefined, undefined, undefined, projectName),
      (id) => this.getNode(id),
      scope
    );
  }

  async retrieveFractal(id: string, maxDepth: number = 10): Promise<FractalRetrievalResult> {
    return retrieveFractalFn((id) => this.getNode(id), id, maxDepth);
  }

  async detectTopicBoundaries(
    scope: MemoryScope | "all",
    minSimilarity: number = 0.7,
    projectName?: string
  ): Promise<MemoryNode[][]> {
    return detectTopicBoundariesFn((s) => this.getDb(s), scope, minSimilarity, projectName);
  }

  async verifyNode(id: string): Promise<MemoryNode> {
    return verifyNodeFn((s) => this.getDb(s), id);
  }

  calculateNodeConfidence(node: MemoryNode): number {
    return calculateNodeConfidenceFn(node);
  }

  async drilldownQuery(
    query: string,
    maxResults: number = 20,
    projectName?: string
  ): Promise<Array<{ node: MemoryNode; relevance: number; path: MemoryNode[]; level: "summary" | "intermediate" | "detail" }>> {
    return drilldownQueryFn({
      getDb: (s) => this.getDb(s),
      searchByEmbedding: (q, limit, opts) => this.searchByEmbedding(q, limit, { ...opts, projectName }),
      getDrilldownPath: (nodeId, maxDepth) => getDrilldownPathFn((id) => this.getNode(id), nodeId, maxDepth),
    }, query, maxResults, projectName);
  }

  async pruneNodes(
    scope: MemoryScope | "all",
    options: {
      minAccessCount?: number | undefined;
      maxAgeDays?: number | undefined;
      minImportance?: number | undefined;
      excludeSticky?: boolean | undefined;
      excludeCore?: boolean | undefined;
      dryRun?: boolean | undefined;
      projectName?: string | undefined;
    } = {}
  ): Promise<{ prunable: MemoryNode[]; pruned: number }> {
    const { projectName, ...rest } = options;
    return pruneNodesFn({
      getDb: (s) => this.getDb(s),
      listNodes: (s, level, limit, offset, includeExpired) => this.listNodes(s, level, limit, offset, includeExpired, projectName),
    }, scope, rest, projectName);
  }

  async getExpiredNodes(scope: MemoryScope | "all" = "all", projectName?: string): Promise<MemoryNode[]> {
    return getExpiredNodesFn((s) => this.getDb(s), scope, projectName);
  }

  async deleteExpiredNodes(scope: MemoryScope | "all" = "all", projectName?: string): Promise<number> {
    return deleteExpiredNodesFn((s) => this.getDb(s), scope, projectName);
  }

  async getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string> {
    return this.configStore.getConfig(scope, key, defaultValue);
  }

  async setConfig(scope: MemoryScope, key: string, value: string): Promise<void> {
    return this.configStore.setConfig(scope, key, value);
  }

  async recordCompressionStat(stat: {
    sessionId?: string;
    command: string;
    strategy: string;
    originalChars: number;
    compressedChars: number;
    originalLines?: number;
    compressedLines?: number;
    cmdPreview?: string;
    originalPreview?: string;
    compressedPreview?: string;
    durationMs?: number;
  }): Promise<void> {
    return this.compressionStore.recordCompressionStat(stat);
  }

  async logToolCall(toolName: string, resultTokens: number, contextWarning: boolean, success: boolean, durationMs: number = 0): Promise<void> {
    return this.sessionTracker.logToolCall(toolName, resultTokens, contextWarning, success, durationMs);
  }

  async getToolPatterns(_scope: "all" | "global" | "project"): Promise<Array<{ toolName: string; count: number; avgTokens: number; avgDurationMs: number; warningRate: number; successRate: number }>> {
    return this.sessionTracker.getToolPatterns(_scope);
  }

  async getFrequentSequences(_scope: "all" | "global" | "project", minCount: number = 3): Promise<Array<{ prev: string; next: string; count: number }>> {
    return this.sessionTracker.getFrequentSequences(_scope, minCount);
  }

  async pruneUsageLog(maxAgeMs?: number): Promise<number> {
    return this.sessionTracker.pruneUsageLog(maxAgeMs);
  }

  async recordAgentToolCall(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown> | null,
    output: string | null,
    success: boolean | null,
    durationMs: number | null
  ): Promise<void> {
    return this.sessionTracker.recordAgentToolCall(sessionId, toolName, args, output, success, durationMs);
  }

  async createSessionMetrics(sessionId: string, startedAt?: number): Promise<void> {
    return this.sessionTracker.createSessionMetrics(sessionId, startedAt);
  }

  async updateSessionMetrics(
    sessionId: string,
    updates: Partial<{
      endedAt: number;
      totalToolCalls: number;
      fileReads: number;
      fileEdits: number;
      bashCommands: number;
      memoryTools: number;
      failedTools: number;
      uniqueFilesTouched: string[];
      injectionCount: number;
      injectedTokens: number;
      taskDescription: string;
      status: string;
    }>
  ): Promise<void> {
    return this.sessionTracker.updateSessionMetrics(sessionId, updates as Parameters<typeof this.sessionTracker.updateSessionMetrics>[1]);
  }

  async incrementSessionToolCall(
    sessionId: string,
    toolName: string,
    success: boolean,
    filePath?: string | null
  ): Promise<void> {
    return this.sessionTracker.incrementSessionToolCall(sessionId, toolName, success, filePath);
  }

  async getSessionStats(sessionId: string): Promise<{
    sessionId: string;
    startedAt: number;
    endedAt: number | null;
    status: string;
    totalToolCalls: number;
    fileReads: number;
    fileEdits: number;
    bashCommands: number;
    memoryTools: number;
    failedTools: number;
    uniqueFilesTouched: string[];
    injectionCount: number;
    injectedTokens: number;
    toolCalls: Array<{
      toolName: string;
      timestamp: number;
      toolCategory: string;
      filePath: string | null;
      command: string | null;
      success: boolean | null;
    }>;
  } | null> {
    return this.sessionTracker.getSessionStats(sessionId);
  }

  async getSessionMetrics(sessionId: string): Promise<{
    totalInjections: number;
    totalToolCalls: number;
    memoryToolsUsed: string[];
    avgEffectiveness: number | null;
  } | null> {
    return this.sessionTracker.getSessionMetrics(sessionId);
  }

  async recordMemoryToolCall(sessionId: string, toolName: string, _args?: Record<string, unknown>): Promise<void> {
    return this.sessionTracker.recordMemoryToolCall(sessionId, toolName, _args);
  }

  async logInjectionMetrics(
    sessionId: string,
    data: {
      injectedNodeCount: number;
      injectedTokens: number;
      injectionMode: string;
      queryText?: string;
      preRerankIds?: string[];
      postRerankIds?: string[];
      rerankScores?: number[];
      rerankStrategy?: string;
      rerankDurationMs?: number;
      injectedNodeTypes?: Record<string, number>;
      activeTypeBoosts?: Record<string, number>;
    }
  ): Promise<void> {
    return this.injectionStore.logInjectionMetrics(sessionId, data);
  }

  async getPendingInjections(): Promise<Array<{ id: number; nodeId: string; scope: string; source: string; createdAt: string }>> {
    return this.injectionStore.getPendingInjections();
  }

  async markInjectionProcessed(id: number): Promise<void> {
    return this.injectionStore.markInjectionProcessed(id);
  }

  async finalizeInjection(sessionId: string, effectivenessScore?: number, taskDescription?: string): Promise<void> {
    return this.injectionStore.finalizeInjection(sessionId, effectivenessScore, taskDescription);
  }

  async recordInjectionFeedback(
    sessionId: string,
    upvotes: number,
    downvotes: number,
    taskOutcome?: string,
    neededNodes?: string[]
  ): Promise<void> {
    return this.injectionStore.recordInjectionFeedback(sessionId, upvotes, downvotes, taskOutcome, neededNodes);
  }

  async getInjectionMetrics(limit = 100): Promise<Array<{
    sessionId: string; timestamp: number; injectedNodeCount: number;
    injectedTokens: number; injectionMode: string; queryText: string | null;
    preRerankIds: string[] | null; postRerankIds: string[] | null;
    rerankScores: number[] | null; rerankStrategy: string | null;
    rerankDurationMs: number | null;
    injectedNodeTypes: Record<string, number> | null;
    activeTypeBoosts: Record<string, number> | null;
    injectedContent: Array<{ label: string; type: string; snippet: string }> | null;
    toolCalls: number; effectivenessScore: number | null;
    injectionUpvotes: number; injectionDownvotes: number;
    taskOutcome: string | null;
  }>> {
    return this.injectionStore.getInjectionMetrics(limit);
  }

  async injectNode(nodeId: string, scope: string): Promise<void> {
    return this.injectionStore.injectNode(nodeId, scope);
  }

  async getCompressionStats(days: number = 7, limit: number = 100): Promise<import("../domain/ports/CompressionStore").CompressionStatsResult> {
    return this.compressionStore.getCompressionStats(days, limit);
  }

  async getContextDashboard(): Promise<import("../domain/ports/CompressionStore").ContextDashboardResult> {
    return this.compressionStore.getContextDashboard();
  }

  async recordTokenUsage(entry: import("../domain/ports/CompressionStore").TokenTrackingEntry): Promise<void> {
    return this.compressionStore.recordTokenUsage(entry);
  }

  async getTokenHistory(days?: number, limit?: number): Promise<import("../domain/ports/CompressionStore").TokenHistoryResult> {
    return this.compressionStore.getTokenHistory(days, limit);
  }

  async recordConversationTurn(turn: import("../domain/ports/LiveFeedStore").ConversationTurn): Promise<void> {
    return this.liveFeedStore.recordConversationTurn(turn);
  }

  async getLiveFeedSnapshot(limit?: number): Promise<import("../domain/ports/LiveFeedStore").LiveFeedSnapshot> {
    return this.liveFeedStore.getLiveFeedSnapshot(limit);
  }
}

export function createSqliteMemoryStore(projectDirectory: string, globalDbPath?: string): MemoryStore {
  return new SqliteMemoryStore(projectDirectory, globalDbPath);
}
