import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { memLog } from "../../logging";

export interface MemConfig {
  maxInjectionTokens: number;
  coreInjectionTokens: number;
  cacheSize: number;
  cacheTTLHours: number;
  autoCompressThreshold: number;
  highContextThreshold: number;
  criticalContextThreshold: number;
  enableMiddleTermCapture: boolean;
  defaultTtlDays: number;
  autoFileSummarization?: {
    enabled: boolean;
  };
  adaptivePressure?: {
    enabled: boolean;
    warnThreshold: number;
    aggressiveThreshold: number;
    criticalThreshold: number;
  };
  commandCompression?: {
    enabled: boolean;
    maxLines: number;
    excludeCommands: string[];
    alwaysFullOnFailure: boolean;
    fuzzyDedupEnabled: boolean;
    fuzzyDedupThreshold: number;
    fuzzyDedupMax: number;
    structuralShapeDetection: boolean;
    relevanceTrimmingEnabled: boolean;
    relevanceTrimmingThreshold: number;
    relevanceTrimmingMinKeep: number;
    relevanceTrimmingAlwaysKeepTop: number;
    deltaCompressionEnabled: boolean;
    deltaMaxCacheSize: number;
    deltaMinSimilarity: number;
  };
  fileSkeletonization?: {
    enabled: boolean;
    minLines: number;
    strategy: string;
  };
  autoRetrieve?: {
    enabled: boolean;
    candidateCount: number;
    maxInjectNodes: number;
    maxInjectPlaybooks: number;
    minQueryLength: number;
    injectionCooldownMs: number;
    minInjectionScore: number;
  };
  ollama?: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    mode: "binary" | "score";
    strategy: "llm" | "cross-encoder";
  };
  llmCompression?: {
    enabled: boolean;
    model?: string;
    maxSummaryTokens: number;
  };
  autoDistill?: {
    enabled: boolean;
    minLessons: number;
    useLlm: boolean;
  };
  predictiveRating?: {
    enabled: boolean;
    decayDays: number;
    confidenceThreshold: number;
    positiveBoost: number;
    negativePenalty: number;
  };
  autoConsolidate?: {
    enabled: boolean;
    similarityThreshold: number;
    maxFactsPerCluster: number;
    minClusterSize: number;
  };
  autoDiscover?: {
    enabled: boolean;
    minSequenceLength: number;
    minRepeatCount: number;
    maxInjectPlaybooks: number;
  };
  journal?: {
    enabled: boolean;
    tags?: Array<{ name: string; description: string }>;
  };
  management?: {
    enabled: boolean;
    port?: number;
  };
  sessionLog?: {
    enabled: boolean;
  };
  reReadElimination?: {
    enabled: boolean;
    maxCacheSize: number;
  };
  outputOffloading?: {
    enabled: boolean;
    thresholdChars: number;
  };
  outputTokenControl?: {
    enabled: boolean;
    mode: "off" | "always-on" | "adaptive";
    strategy: "concise" | "sentence_limit" | "char_limit" | "bullet_only" | "custom";
    maxSentences: number;
    maxChars: number;
    customPrompt: string;
    warnThreshold: number;
    aggressiveThreshold: number;
    criticalThreshold: number;
    normalSentences: number;
    warnSentences: number;
    aggressiveSentences: number;
    criticalSentences: number;
    normalStrategy: string;
    warnStrategy: string;
    aggressiveStrategy: string;
    criticalStrategy: string;
    normalPrompt: string;
    warnPrompt: string;
    aggressivePrompt: string;
    criticalPrompt: string;
    excludePatterns: string[];
  };
}

const AutoRetrieveSchema = z.object({
  enabled: z.boolean().default(false),
  candidateCount: z.number().positive().int().default(30),
  maxInjectNodes: z.number().positive().int().default(5),
  maxInjectPlaybooks: z.number().positive().int().default(3),
  minQueryLength: z.number().int().default(10),
  injectionCooldownMs: z.number().int().default(30000),
  minInjectionScore: z.number().min(0).max(1).default(0.05),
});

const OllamaSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().default("http://localhost:11434"),
  model: z.string().default("qwen2.5-coder:latest"),
  mode: z.enum(["binary", "score"]).default("binary"),
  strategy: z.enum(["llm", "cross-encoder"]).default("llm"),
});

const LlmCompressionSchema = z.object({
  enabled: z.boolean().default(false),
  model: z.string().optional(),
  maxSummaryTokens: z.number().positive().int().default(500),
});

const AutoDistillSchema = z.object({
  enabled: z.boolean().default(false),
  minLessons: z.number().positive().int().default(3),
  useLlm: z.boolean().default(false),
});

const AutoDiscoverSchema = z.object({
  enabled: z.boolean().default(false),
  minSequenceLength: z.number().positive().int().default(3),
  minRepeatCount: z.number().positive().int().default(2),
  maxInjectPlaybooks: z.number().positive().int().default(3),
});

const AutoConsolidateSchema = z.object({
  enabled: z.boolean().default(false),
  similarityThreshold: z.number().min(0).max(1).default(0.3),
  maxFactsPerCluster: z.number().positive().int().default(5),
  minClusterSize: z.number().positive().int().default(2),
});

const PredictiveRatingSchema = z.object({
  enabled: z.boolean().default(false),
  decayDays: z.number().positive().default(30),
  confidenceThreshold: z.number().min(0).max(1).default(0.3),
  positiveBoost: z.number().min(0).max(1).default(0.1),
  negativePenalty: z.number().min(0).max(1).default(0.05),
});

const JournalTagSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const JournalSchema = z.object({
  enabled: z.boolean().default(false),
  tags: z.array(JournalTagSchema).optional(),
});

const ManagementSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().positive().int().optional(),
});

const CommandCompressionSchema = z.object({
  enabled: z.boolean().default(true),
  maxLines: z.number().positive().int().default(50),
  excludeCommands: z.array(z.string()).default([]),
  alwaysFullOnFailure: z.boolean().default(true),
  fuzzyDedupEnabled: z.boolean().default(true),
  fuzzyDedupThreshold: z.number().min(0).max(1).default(0.85),
  fuzzyDedupMax: z.number().positive().int().default(50),
  structuralShapeDetection: z.boolean().default(true),
  relevanceTrimmingEnabled: z.boolean().default(false),
  relevanceTrimmingThreshold: z.number().min(0).max(1).default(0.15),
  relevanceTrimmingMinKeep: z.number().positive().int().default(5),
  relevanceTrimmingAlwaysKeepTop: z.number().int().min(0).default(3),
  deltaCompressionEnabled: z.boolean().default(true),
  deltaMaxCacheSize: z.number().positive().int().default(50),
  deltaMinSimilarity: z.number().min(0).max(1).default(0.5),
});

const FileSkeletonizationSchema = z.object({
  enabled: z.boolean().default(true),
  minLines: z.number().positive().int().default(200),
  strategy: z.string().default("ast+regex"),
});

const SessionLogSchema = z.object({
  enabled: z.boolean().default(false),
});

const AdaptivePressureSchema = z.object({
  enabled: z.boolean().default(false),
  warnThreshold: z.number().min(0).max(1).default(0.7),
  aggressiveThreshold: z.number().min(0).max(1).default(0.85),
  criticalThreshold: z.number().min(0).max(1).default(0.95),
});

const ReReadEliminationSchema = z.object({
  enabled: z.boolean().default(true),
  maxCacheSize: z.number().positive().int().default(100),
});

const OutputOffloadingSchema = z.object({
  enabled: z.boolean().default(true),
  thresholdChars: z.number().positive().int().default(8000),
});

const OutputTokenControlSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["off", "always-on", "adaptive"]).default("adaptive"),
  strategy: z.enum(["concise", "sentence_limit", "char_limit", "bullet_only", "custom"]).default("concise"),
  maxSentences: z.number().int().min(1).default(5),
  maxChars: z.number().int().min(0).default(0),
  customPrompt: z.string().default(""),
  warnThreshold: z.number().min(0).max(1).default(0.7),
  aggressiveThreshold: z.number().min(0).max(1).default(0.85),
  criticalThreshold: z.number().min(0).max(1).default(0.95),
  normalSentences: z.number().int().min(1).default(5),
  warnSentences: z.number().int().min(1).default(3),
  aggressiveSentences: z.number().int().min(1).default(1),
  criticalSentences: z.number().int().min(1).default(1),
  normalStrategy: z.string().default("concise"),
  warnStrategy: z.string().default("sentence_limit"),
  aggressiveStrategy: z.string().default("sentence_limit"),
  criticalStrategy: z.string().default("char_limit"),
  normalPrompt: z.string().default(""),
  warnPrompt: z.string().default(""),
  aggressivePrompt: z.string().default(""),
  criticalPrompt: z.string().default(""),
  excludePatterns: z.array(z.string()).default([]),
});

const DEFAULT_CONFIG: MemConfig = {
  maxInjectionTokens: 8000,
  coreInjectionTokens: 2000,
  cacheSize: 8,
  cacheTTLHours: 2,
  autoCompressThreshold: 0.7,
  highContextThreshold: 0.6,
  criticalContextThreshold: 0.8,
  enableMiddleTermCapture: true,
  defaultTtlDays: 0,
  autoFileSummarization: {
    enabled: false,
  },
  autoRetrieve: {
    enabled: false,
    candidateCount: 30,
    maxInjectNodes: 5,
    maxInjectPlaybooks: 3,
    minQueryLength: 10,
    injectionCooldownMs: 30000,
    minInjectionScore: 0.05,
  },
  ollama: {
    enabled: false,
    baseUrl: "http://localhost:11434",
    model: "qwen2.5-coder:latest",
    mode: "binary",
    strategy: "llm",
  },
  llmCompression: {
    enabled: false,
    maxSummaryTokens: 500,
  },
  autoDistill: {
    enabled: false,
    minLessons: 3,
    useLlm: false,
  },
  predictiveRating: {
    enabled: false,
    decayDays: 30,
    confidenceThreshold: 0.3,
    positiveBoost: 0.1,
    negativePenalty: 0.05,
  },
  autoDiscover: {
    enabled: false,
    minSequenceLength: 3,
    minRepeatCount: 2,
    maxInjectPlaybooks: 3,
  },
  autoConsolidate: {
    enabled: false,
    similarityThreshold: 0.3,
    maxFactsPerCluster: 5,
    minClusterSize: 2,
  },
  journal: {
    enabled: false,
  },
  management: {
    enabled: false,
  },
  sessionLog: {
    enabled: false,
  },
  adaptivePressure: {
    enabled: false,
    warnThreshold: 0.7,
    aggressiveThreshold: 0.85,
    criticalThreshold: 0.95,
  },
  reReadElimination: {
    enabled: true,
    maxCacheSize: 100,
  },
  outputOffloading: {
    enabled: true,
    thresholdChars: 8000,
  },
  outputTokenControl: {
    enabled: false,
    mode: "adaptive",
    strategy: "concise",
    maxSentences: 5,
    maxChars: 0,
    customPrompt: "",
    warnThreshold: 0.7,
    aggressiveThreshold: 0.85,
    criticalThreshold: 0.95,
    normalSentences: 5,
    warnSentences: 3,
    aggressiveSentences: 1,
    criticalSentences: 1,
    normalStrategy: "concise",
    warnStrategy: "sentence_limit",
    aggressiveStrategy: "sentence_limit",
    criticalStrategy: "char_limit",
    normalPrompt: "",
    warnPrompt: "",
    aggressivePrompt: "",
    criticalPrompt: "",
    excludePatterns: [],
  },
  commandCompression: {
    enabled: true,
    maxLines: 50,
    excludeCommands: ["curl", "wget"],
    alwaysFullOnFailure: true,
    fuzzyDedupEnabled: true,
    fuzzyDedupThreshold: 0.85,
    fuzzyDedupMax: 50,
    structuralShapeDetection: true,
    relevanceTrimmingEnabled: false,
    relevanceTrimmingThreshold: 0.15,
    relevanceTrimmingMinKeep: 5,
    relevanceTrimmingAlwaysKeepTop: 3,
    deltaCompressionEnabled: true,
    deltaMaxCacheSize: 50,
    deltaMinSimilarity: 0.5,
  },
  fileSkeletonization: {
    enabled: true,
    minLines: 200,
    strategy: "ast+regex",
  },
};

const MemConfigSchema = z.object({
  maxInjectionTokens: z.number().positive().int().default(8000),
  coreInjectionTokens: z.number().positive().int().default(2000),
  cacheSize: z.number().positive().int().default(8),
  cacheTTLHours: z.number().positive().default(2),
  autoCompressThreshold: z.number().min(0).max(1).default(0.7),
  highContextThreshold: z.number().min(0).max(1).default(0.6),
  criticalContextThreshold: z.number().min(0).max(1).default(0.8),
  enableMiddleTermCapture: z.boolean().default(true),
  defaultTtlDays: z.number().int().min(0).default(0),
  autoFileSummarization: z.object({
    enabled: z.boolean().default(false),
  }).optional(),
  autoRetrieve: AutoRetrieveSchema.optional(),
  ollama: OllamaSchema.optional(),
  llmCompression: LlmCompressionSchema.optional(),
  autoDistill: AutoDistillSchema.optional(),
  predictiveRating: PredictiveRatingSchema.optional(),
  autoDiscover: AutoDiscoverSchema.optional(),
  autoConsolidate: AutoConsolidateSchema.optional(),
  journal: JournalSchema.optional(),
  management: ManagementSchema.optional(),
  sessionLog: SessionLogSchema.optional(),
  adaptivePressure: AdaptivePressureSchema.optional(),
  reReadElimination: ReReadEliminationSchema.optional(),
  outputOffloading: OutputOffloadingSchema.optional(),
  outputTokenControl: OutputTokenControlSchema.optional(),
  commandCompression: CommandCompressionSchema.optional(),
  fileSkeletonization: FileSkeletonizationSchema.optional(),
}).default(DEFAULT_CONFIG);

export async function loadMemConfig(_projectRoot: string): Promise<MemConfig> {
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-mem.json");

  try {
    const raw = await fs.promises.readFile(configPath, "utf-8");
    const parsed = MemConfigSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (err) {
    memLog("warn", "config", "Failed to load config, using defaults", { error: String(err), configPath });
    return DEFAULT_CONFIG;
  }
}
