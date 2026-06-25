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
}

export interface FuzzyDedupConfig {
  enabled: boolean;
  similarityThreshold: number;
  maxComparisons: number;
}

export const DEFAULT_FUZZY: FuzzyDedupConfig = { enabled: true, similarityThreshold: 0.85, maxComparisons: 50 };
