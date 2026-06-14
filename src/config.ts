import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { memLog } from "./logging";

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
  autoRetrieve?: {
    enabled: boolean;
    candidateCount: number;
    maxInjectNodes: number;
    maxInjectPlaybooks: number;
    minQueryLength: number;
    injectionCooldownMs: number;
  };
  ollama?: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    mode: "binary" | "score";
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
}

const AutoRetrieveSchema = z.object({
  enabled: z.boolean().default(false),
  candidateCount: z.number().positive().int().default(30),
  maxInjectNodes: z.number().positive().int().default(5),
  maxInjectPlaybooks: z.number().positive().int().default(3),
  minQueryLength: z.number().int().default(10),
  injectionCooldownMs: z.number().int().default(30000),
});

const OllamaSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().default("http://localhost:11434"),
  model: z.string().default("qwen2.5-coder:1.5b"),
  mode: z.enum(["binary", "score"]).default("binary"),
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
  },
  ollama: {
    enabled: false,
    baseUrl: "http://localhost:11434",
    model: "qwen2.5-coder:1.5b",
    mode: "binary",
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
  journal: {
    enabled: false,
  },
  management: {
    enabled: false,
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
  journal: JournalSchema.optional(),
  management: ManagementSchema.optional(),
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
