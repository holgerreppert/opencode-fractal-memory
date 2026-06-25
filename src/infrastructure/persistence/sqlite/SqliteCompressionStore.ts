import type { Database } from "bun:sqlite";
import type { ICompressionStore, CompressionStatsResult, ContextDashboardResult } from "../../../domain/ports/ICompressionStore";
import { queryInjectionMetrics } from "../../../storage/injection-events";

export class SqliteCompressionStore implements ICompressionStore {
  constructor(private getDb: () => Promise<Database>) {}

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
    const db = await this.getDb();
    db.run(
      `INSERT INTO compression_stats (session_id, timestamp, command, strategy, original_chars, compressed_chars, original_lines, compressed_lines, cmd_preview, original_preview, compressed_preview, savings_ratio, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stat.sessionId ?? null,
        Date.now(),
        stat.command.slice(0, 100),
        stat.strategy,
        stat.originalChars,
        stat.compressedChars,
        stat.originalLines ?? null,
        stat.compressedLines ?? null,
        stat.cmdPreview ?? null,
        stat.originalPreview ?? null,
        stat.compressedPreview ?? null,
        stat.originalChars > 0 ? 1 - stat.compressedChars / stat.originalChars : 0,
        stat.durationMs ?? null,
      ]
    );
  }

  async getCompressionStats(days: number = 7, limit: number = 100): Promise<CompressionStatsResult> {
    const db = await this.getDb();
    const since = Date.now() - days * 86400000;

    const total = db.query(
      "SELECT COUNT(*) as c, SUM(original_chars) as raw, SUM(compressed_chars) as comp FROM compression_stats WHERE timestamp >= ?"
    ).get(since) as { c: number; raw: number; comp: number } | undefined;

    const byStrategy = db.query(
      "SELECT strategy, COUNT(*) as calls, SUM(original_chars) as raw, SUM(compressed_chars) as comp, ROUND(AVG(savings_ratio) * 100, 1) as avg_savings FROM compression_stats WHERE timestamp >= ? GROUP BY strategy ORDER BY calls DESC"
    ).all(since) as Array<{ strategy: string; calls: number; raw: number; comp: number; avg_savings: number }>;

    const byCommand = db.query(
      "SELECT command, COUNT(*) as calls, SUM(original_chars) as raw, SUM(compressed_chars) as comp FROM compression_stats WHERE timestamp >= ? GROUP BY command ORDER BY calls DESC LIMIT ?"
    ).all(since, limit) as Array<{ command: string; calls: number; raw: number; comp: number }>;

    const recent = db.query(
      "SELECT timestamp, command, strategy, original_chars, compressed_chars, original_lines, compressed_lines, cmd_preview, original_preview, compressed_preview, savings_ratio, duration_ms FROM compression_stats WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 20"
    ).all(since) as Array<{
      timestamp: number; command: string; strategy: string;
      original_chars: number; compressed_chars: number;
      original_lines: number; compressed_lines: number;
      cmd_preview: string; original_preview: string;
      compressed_preview: string; savings_ratio: number; duration_ms: number;
    }>;

    return {
      total: {
        calls: total?.c ?? 0,
        originalChars: total?.raw ?? 0,
        compressedChars: total?.comp ?? 0,
        savingsPercent: total?.raw ? Math.round((1 - (total?.comp ?? 0) / (total?.raw ?? 1)) * 100) : 0,
      },
      byStrategy: byStrategy.map(s => ({
        strategy: s.strategy,
        calls: s.calls,
        raw: s.raw,
        comp: s.comp,
        avgSavings: s.avg_savings,
      })),
      byCommand: byCommand.slice(0, limit).map(c => ({
        command: c.command,
        calls: c.calls,
        raw: c.raw,
        comp: c.comp,
      })),
      recent: recent.slice(0, 20).map(r => ({
        timestamp: r.timestamp,
        command: r.command,
        strategy: r.strategy,
        originalChars: r.original_chars,
        compressedChars: r.compressed_chars,
        originalLines: r.original_lines ?? null,
        compressedLines: r.compressed_lines ?? null,
        cmdPreview: r.cmd_preview ?? null,
        originalPreview: r.original_preview ?? null,
        compressedPreview: r.compressed_preview ?? null,
        durationMs: r.duration_ms ?? null,
        savingsRatio: r.savings_ratio,
      })),
    };
  }

  async getContextDashboard(): Promise<ContextDashboardResult> {
    const db = await this.getDb();

    const nodesByLevel = db.query(
      "SELECT level, COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM memory_nodes WHERE scope = 'global' GROUP BY level ORDER BY level"
    ).all() as { level: number; count: number; total_chars: number | null }[];

    const nodesByType = db.query(
      "SELECT type, COUNT(*) as count, SUM(LENGTH(content)) as total_chars FROM memory_nodes WHERE scope = 'global' GROUP BY type ORDER BY count DESC"
    ).all() as { type: string; count: number; total_chars: number | null }[];

    const ruleCount = (db.query(
      "SELECT COUNT(*) as count FROM memory_nodes WHERE label LIKE 'rule:%'"
    ).get() as { count: number })?.count ?? 0;

    const totalNodes = (db.query(
      "SELECT COUNT(*) as count FROM memory_nodes WHERE scope = 'global'"
    ).get() as { count: number })?.count ?? 0;

    const totalChars = (db.query(
      "SELECT SUM(LENGTH(content)) as total FROM memory_nodes WHERE scope = 'global'"
    ).get() as { total: number | null })?.total ?? 0;

    const compressTotal = db.query(
      "SELECT COUNT(*) as calls, SUM(original_chars) as raw, SUM(compressed_chars) as comp FROM compression_stats"
    ).get() as { calls: number; raw: number | null; comp: number | null } | undefined;

    const recentInjections = queryInjectionMetrics(db, 5);

    const totalMemoryTokens = nodesByLevel.reduce((s, r) => s + ((r.total_chars ?? 0) / 4), 0);

    const compressedSavings = compressTotal && compressTotal.raw
      ? Math.round((1 - (compressTotal.comp ?? 0) / (compressTotal.raw ?? 1)) * 100)
      : 0;

    return {
      memory: {
        totalNodes,
        totalTokens: Math.round(totalMemoryTokens),
        totalChars,
        byLevel: nodesByLevel.map(r => ({
          level: r.level,
          count: r.count,
          tokens: Math.round((r.total_chars ?? 0) / 4),
        })),
        byType: nodesByType.map(r => ({
          type: r.type,
          count: r.count,
          tokens: Math.round((r.total_chars ?? 0) / 4),
        })),
        rules: ruleCount,
      },
      compression: {
        totalCalls: compressTotal?.calls ?? 0,
        originalChars: compressTotal?.raw ?? 0,
        compressedChars: compressTotal?.comp ?? 0,
        savingsPercent: compressedSavings,
      },
      injections: recentInjections.map(m => ({
        sessionId: m.sessionId,
        timestamp: m.timestamp,
        nodeCount: m.injectedNodeCount,
        tokens: m.injectedTokens,
        mode: m.injectionMode,
        strategy: m.rerankStrategy,
      })),
      overhead: {
        systemPromptTokens: 3000,
        toolDefTokens: 4000,
      },
    };
  }
}
