import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";

import { runMigrations, getConfig, setConfig } from "./migrations";
import { getHNSWIndex } from "../hnsw-index";
import { type SqliteNode } from "./queries/base";
import { tokenize, extractLinks, embeddingToBlob, blobToEmbedding, withRetry, withRetryableTransaction } from "./utils";
export { extractLinks, embeddingToBlob, blobToEmbedding, tokenize, withRetry, withRetryableTransaction };
import type { MemoryNode, MemoryScope, MemoryNodeLevel, MemoryNodeType, MemoryCategory, CreateNodeInput, FractalStats, FractalRetrievalResult, DrilldownResult, MemoryStore } from "./types";
import { queryListNodes, queryGetNode, queryGetNodeByLabel, queryGetNodeByLabelFull, queryGetNodeByPrefix, queryCreateNode, queryUpdateNode, queryDeleteNode } from "./queries/nodes";
import { queryStoreLinks, queryUpdateLinksForNewNode, queryGetLinks, queryDeleteLinks } from "./queries/links";
import { queryCreateTemporalEdge, queryGetTemporalEdges, queryExpandWithTemporalEdges, queryDeleteTemporalEdgesForNode } from "./queries/temporal-edges";
import { updateBM25Index, removeBM25Index } from "./queries/search-helpers";
import { CompressionHelper, COMPRESSION_LEVELS } from "./compression";
export { CompressionHelper, COMPRESSION_LEVELS };
import { memLog } from "../logging";
import { insertToolUsageLog, queryToolPatterns, queryFrequentSequences, deleteUsageLog, getToolCategory } from "./tool-usage";
import { insertAgentToolCall, createSessionMetrics as createSessionMetricsRow, updateSessionMetrics, incrementSessionToolCall, getSessionStats as getSessionStatsForSession } from "./session-tracking";
import { insertInjectionMetrics, getPendingInjections as getPendingInjectionRows, markInjectionProcessed, updateMemoryToolCall, finalizeInjection, insertInjectionFeedback, queryInjectionMetrics, querySessionMetrics, type InjectionQualityRow } from "./injection-events";
import { runScoreDecay as runScoreDecayFn, calculateNodeConfidence as calculateNodeConfidenceFn } from "./scoring";
import { ensureSeed as ensureSeedFn, resolveNode as resolveNodeFn, getNode as getNodeFn, verifyNode as verifyNodeFn } from "./lifecycle";
import { searchByEmbedding as searchByEmbeddingFn, detectTopicBoundaries as detectTopicBoundariesFn, drilldownQuery as drilldownQueryFn, getDrilldownPath as getDrilldownPathFn } from "./search";
import { retrieveFractal as retrieveFractalFn, getFractalStats as getFractalStatsFn } from "./navigation";
import { getCompressionCandidates as getCompressionCandidatesFn, runCompression as runCompressionFn, runPatternExtraction as runPatternExtractionFn } from "./compress-ops";
import { getExpiredNodes as getExpiredNodesFn, deleteExpiredNodes as deleteExpiredNodesFn, pruneNodes as pruneNodesFn } from "./expiration";
import { backfillLinks as backfillLinksFn, backfillBinaryEmbeddingsAndBM25 as backfillBinaryEmbeddingsAndBM25Fn, rebuildHNSWIndex as rebuildHNSWIndexFn } from "./maintenance";

export type { MemoryScope, MemoryNodeLevel, MemoryNode, MemoryNodeType, MemoryCategory, CreateNodeInput, FractalStats, FractalRetrievalResult, DrilldownResult, MemoryStore } from "./types";

const SEED_BLOCKS: Array<{ scope: MemoryScope; label: string }> = [
  { scope: "global", label: "persona" },
  { scope: "global", label: "human" },
  { scope: "project", label: "project" },
];

function scopeDbPath(_projectDirectory: string, _scope: MemoryScope, globalDbPath?: string): string {
  return globalDbPath ?? path.join(os.homedir(), ".config", "opencode", "memory.db");
}

function validateLabel(label: string): string {
  const trimmed = label.trim();
  if (!/^[a-z0-9][a-z0-9-_:]{1,60}$/i.test(trimmed)) {
    throw new Error(
      `Invalid label "${label}". Use letters/numbers/dash/underscore/colon (2-61 chars).`,
    );
  }
  return trimmed;
}

class SqliteMemoryStore {
  private dbs: Map<string, Database> = new Map();
  private dbInitPromises: Map<string, Promise<Database>> = new Map();
  private idScopeCache: Map<string, MemoryScope> = new Map();
  private projectDirectory: string;
  private globalDbPath?: string;
  private _projectName: string;

  get projectName(): string {
    return this._projectName;
  }

  constructor(projectDirectory: string, globalDbPath?: string) {
    this.projectDirectory = projectDirectory;
    this.globalDbPath = globalDbPath;
    this._projectName = path.basename(projectDirectory);
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

  async runScoreDecay(decayDays: number): Promise<number> {
    return runScoreDecayFn((s) => this.getDb(s), decayDays);
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

  async updateNode(id: string, updates: Partial<Pick<MemoryNode, "content" | "summary" | "level" | "parentIds" | "importance" | "type" | "category" | "metadata" | "embedding" | "sticky" | "confidence" | "usefulnessScore" | "timesHelpful">>): Promise<void> {
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

  async getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string> {
    const db = await this.getDb(scope);
    return getConfig(db, key, defaultValue);
  }

  async setConfig(scope: MemoryScope, key: string, value: string): Promise<void> {
    const db = await this.getDb(scope);
    await withRetry(() => setConfig(db, key, value));
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
    const db = await this.getDb(scope as any ?? "project");
    return queryCreateTemporalEdge(db, { sourceNodeId, targetNodeId, edgeType, scope, confidence, metadata });
  }

  async getTemporalEdges(
    nodeId: string, direction?: "outgoing" | "incoming" | "both", edgeType?: string,
  ): Promise<import("./types").TemporalEdge[]> {
    const db = await this.getDb("project");
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

  async rebuildHNSWIndex(scope?: MemoryScope | "all"): Promise<void> {
    return rebuildHNSWIndexFn((s) => this.getDb(s), scope);
  }

  async searchByEmbedding(
    query: number[],
    limit: number = 5,
    options?: { minLevel?: MemoryNodeLevel; maxLevel?: MemoryNodeLevel; levelWeights?: Partial<Record<MemoryNodeLevel, number>>; bm25Weight?: number; queryText?: string; minUsefulness?: number; rerank?: boolean; bm25Scores?: Map<string, number>; projectName?: string; temporalBoost?: { nodeIds: string[]; edgeType?: string; boostFactor?: number } }
  ): Promise<MemoryNode[]> {
    return searchByEmbeddingFn((s) => this.getDb(s), query, limit, options);
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
    projectName?: string
  ): Promise<{ compressed: number; created: number }> {
    return runCompressionFn({
      getCompressionCandidates: (s, l, maxAge, f) => this.getCompressionCandidates(s, l, maxAge, f, projectName),
      createNode: (node) => this.createNode(node),
      updateNode: (id, updates) => this.updateNode(id, updates),
    }, scope, force, client);
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

  async logToolCall(toolName: string, resultTokens: number, contextWarning: boolean, success: boolean, durationMs: number = 0): Promise<void> {
    const db = await this.getDb("global");
    await insertToolUsageLog(db, toolName, resultTokens, contextWarning, success, durationMs);
  }

  async getToolPatterns(_scope: MemoryScope | "all"): Promise<Array<{ toolName: string; count: number; avgTokens: number; avgDurationMs: number; warningRate: number; successRate: number }>> {
    const db = await this.getDb("global");
    return queryToolPatterns(db);
  }

  async getFrequentSequences(_scope: MemoryScope | "all", minCount: number = 3): Promise<Array<{ prev: string; next: string; count: number }>> {
    const db = await this.getDb("global");
    return queryFrequentSequences(db, minCount);
  }

  async pruneUsageLog(maxAgeMs?: number): Promise<number> {
    const db = await this.getDb("global");
    return deleteUsageLog(db, maxAgeMs);
  }

  private getToolCategory(toolName: string): string {
    return getToolCategory(toolName);
  }

  async recordAgentToolCall(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown> | null,
    output: string | null,
    success: boolean | null,
    durationMs: number | null
  ): Promise<void> {
    const db = await this.getGlobalDb();
    const category = getToolCategory(toolName);
    await insertAgentToolCall(db, sessionId, toolName, args, output, success, durationMs, category);

    if (sessionId) {
      await this.incrementSessionToolCall(sessionId, toolName, success ?? true, null);
    }
  }

  async createSessionMetrics(sessionId: string, startedAt?: number): Promise<void> {
    const db = await this.getGlobalDb();
    await createSessionMetricsRow(db, sessionId, startedAt);
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
    const db = await this.getGlobalDb();
    await updateSessionMetrics(db, sessionId, updates);
  }

  async incrementSessionToolCall(
    sessionId: string,
    toolName: string,
    success: boolean,
    filePath?: string | null
  ): Promise<void> {
    const db = await this.getGlobalDb();
    await incrementSessionToolCall(db, sessionId, toolName, success, filePath);
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
    const db = await this.getGlobalDb();
    return getSessionStatsForSession(db, sessionId);
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
      minAccessCount?: number;
      maxAgeDays?: number;
      minImportance?: number;
      excludeSticky?: boolean;
      excludeCore?: boolean;
      dryRun?: boolean;
      projectName?: string;
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
    const db = await this.getGlobalDb();
    await insertInjectionMetrics(db, sessionId, data);
  }

  async getPendingInjections(): Promise<Array<{ id: number; nodeId: string; scope: string; source: string; createdAt: string }>> {
    const db = await this.getGlobalDb();
    return getPendingInjectionRows(db);
  }

  async markInjectionProcessed(id: number): Promise<void> {
    const db = await this.getGlobalDb();
    markInjectionProcessed(db, id);
  }

  async recordMemoryToolCall(sessionId: string, toolName: string, _args?: Record<string, unknown>): Promise<void> {
    const db = await this.getGlobalDb();
    await updateMemoryToolCall(db, sessionId, toolName);
  }

  async recordCompressionStat(stat: {
    sessionId?: string;
    command: string;
    strategy: string;
    originalChars: number;
    compressedChars: number;
    durationMs?: number;
  }): Promise<void> {
    const db = await this.getGlobalDb();
    db.run(
      `INSERT INTO compression_stats (session_id, timestamp, command, strategy, original_chars, compressed_chars, savings_ratio, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stat.sessionId ?? null,
        Date.now(),
        stat.command.slice(0, 100),
        stat.strategy,
        stat.originalChars,
        stat.compressedChars,
        stat.originalChars > 0 ? 1 - stat.compressedChars / stat.originalChars : 0,
        stat.durationMs ?? null,
      ]
    );
  }

  async finalizeInjection(sessionId: string, effectivenessScore?: number, taskDescription?: string): Promise<void> {
    const db = await this.getGlobalDb();
    await finalizeInjection(db, sessionId, effectivenessScore, taskDescription);
  }

  async recordInjectionFeedback(
    sessionId: string,
    upvotes: number,
    downvotes: number,
    taskOutcome?: string,
    neededNodes?: string[]
  ): Promise<void> {
    const db = await this.getGlobalDb();
    await insertInjectionFeedback(db, sessionId, upvotes, downvotes, taskOutcome, neededNodes);
  }

  async getInjectionMetrics(limit = 100): Promise<InjectionQualityRow[]> {
    const db = await this.getGlobalDb();
    return queryInjectionMetrics(db, limit);
  }

  async getSessionMetrics(sessionId: string): Promise<{
    totalInjections: number;
    totalToolCalls: number;
    memoryToolsUsed: string[];
    avgEffectiveness: number | null;
  }> {
    const db = await this.getGlobalDb();
    return querySessionMetrics(db, sessionId);
  }
}

export function createSqliteMemoryStore(projectDirectory: string, globalDbPath?: string): MemoryStore {
  return new SqliteMemoryStore(projectDirectory, globalDbPath);
}
