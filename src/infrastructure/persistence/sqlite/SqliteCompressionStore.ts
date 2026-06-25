import type { Database } from "bun:sqlite";
import type { ICompressionStore } from "../../../domain/ports/ICompressionStore";

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
}
