export interface ICompressionStore {
  recordCompressionStat(stat: {
    sessionId?: string; command: string; strategy: string;
    originalChars: number; compressedChars: number;
    originalLines?: number; compressedLines?: number;
    cmdPreview?: string; originalPreview?: string;
    compressedPreview?: string; durationMs?: number;
  }): Promise<void>;
}
