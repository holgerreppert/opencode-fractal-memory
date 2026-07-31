export interface CompressConfig {
  enabled: boolean;
  maxLines: number;
  excludeCommands: string[];
  alwaysFullOnFailure: boolean;
  fuzzyDedupEnabled?: boolean;
  fuzzyDedupThreshold?: number;
  fuzzyDedupMax?: number;
  relevanceTrimmingEnabled?: boolean;
  relevanceTrimmingThreshold?: number;
  relevanceTrimmingMinKeep?: number;
  relevanceTrimmingAlwaysKeepTop?: number;
  deltaCompressionEnabled?: boolean;
  deltaMaxCacheSize?: number;
  deltaMinSimilarity?: number;
  ollamaExtraction?: OllamaExtractionConfig | undefined;
  netWinMinTokens?: number;
  verbatimBelowLines?: number;
  benignThreshold?: number;
  errorThreshold?: number;
  keepMatches?: number;
  keepNames?: number;
  keepRows?: number;
  essentialColumns?: Record<string, string[]>;
}

export const DEFAULT_TIERED = {
  netWinMinTokens: 24,
  verbatimBelowLines: 40,
  benignThreshold: 1000,
  errorThreshold: 500,
  keepMatches: 15,
  keepNames: 50,
  keepRows: 20,
} as const;

export interface OllamaExtractionConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  minOutputChars: number;
  timeoutMs: number;
}

export interface FuzzyDedupConfig {
  enabled: boolean;
  similarityThreshold: number;
  maxComparisons: number;
}

export const DEFAULT_FUZZY: FuzzyDedupConfig = { enabled: true, similarityThreshold: 0.85, maxComparisons: 50 };

export const DEFAULT_OLLAMA_EXTRACTION: OllamaExtractionConfig = {
  enabled: false,
  baseUrl: "http://localhost:11434",
  model: "qwen3.5:3b",
  minOutputChars: 2000,
  timeoutMs: 10000,
};
