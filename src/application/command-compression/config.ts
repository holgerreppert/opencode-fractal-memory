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
  squeezExtraction?: SqueezExtractionConfig | undefined;
  netWinMinTokens?: number;
  verbatimBelowLines?: number;
  benignThreshold?: number;
  errorThreshold?: number;
  keepMatches?: number;
  keepNames?: number;
  keepRows?: number;
  essentialColumns?: Record<string, string[]>;
  perTool?: Record<string, { maxTokens?: number; strategy?: "error-first" | "names" | "json-sample" | "generic"; errorThreshold?: number }>;
}

export const DEFAULT_PER_TOOL: Record<string, { maxTokens: number; strategy: "error-first" | "names" | "json-sample" | "generic"; errorThreshold: number }> = {
  "test": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
  "bun test": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
  "pytest": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
  "vitest": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
  "jest": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
  "cargo test": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
  "go test": { maxTokens: 2500, strategy: "error-first", errorThreshold: 500 },
  "ls": { maxTokens: 800, strategy: "names", errorThreshold: 800 },
  "tree": { maxTokens: 800, strategy: "names", errorThreshold: 800 },
  "grep": { maxTokens: 1200, strategy: "generic", errorThreshold: 500 },
  "git diff": { maxTokens: 2000, strategy: "generic", errorThreshold: 500 },
  "git log": { maxTokens: 1500, strategy: "generic", errorThreshold: 500 },
};

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
  /** Defer extraction to session.idle instead of blocking tool.after (default true). */
  deferToIdle?: boolean;
  /** Keep the model resident in Ollama memory between calls (default "30m"). */
  keepAlive?: string;
  /** Max pending extractions queued per process (default 20). */
  maxQueueSize?: number;
}

export interface SqueezExtractionConfig {
  enabled: boolean;
  /** Squeez server base URL (vLLM/Ollama compat), e.g. http://localhost:8000 */
  baseUrl: string;
  /** Model id, e.g. KRLabsOrg/squeez-2b */
  model: string;
  minOutputChars: number;
  timeoutMs: number;
  /** Defer to session.idle like ollamaExtraction (default true) — when true, sync path is no-op */
  deferToIdle?: boolean;
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
  model: "llama3.2:latest",
  minOutputChars: 2000,
  timeoutMs: 10000,
  deferToIdle: true,
  keepAlive: "30m",
  maxQueueSize: 20,
};

export const DEFAULT_SQUEEZ_EXTRACTION: SqueezExtractionConfig = {
  enabled: false,
  baseUrl: "http://localhost:8000",
  model: "KRLabsOrg/squeez-2b",
  minOutputChars: 2000,
  timeoutMs: 5000,
  deferToIdle: true,
};
