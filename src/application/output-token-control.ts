import { writeCompressLog } from "../logging";

export interface OutputTokenControlConfig {
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
}

type PressureLevel = "normal" | "warn" | "aggressive" | "critical";

function getSentences(config: OutputTokenControlConfig, level: PressureLevel): number {
  switch (level) {
    case "critical": return config.criticalSentences;
    case "aggressive": return config.aggressiveSentences;
    case "warn": return config.warnSentences;
    default: return config.normalSentences;
  }
}

function getLevelStrategy(config: OutputTokenControlConfig, level: PressureLevel): string {
  switch (level) {
    case "critical": return config.criticalStrategy;
    case "aggressive": return config.aggressiveStrategy;
    case "warn": return config.warnStrategy;
    default: return config.normalStrategy;
  }
}

function getLevelPrompt(config: OutputTokenControlConfig, level: PressureLevel): string {
  switch (level) {
    case "critical": return config.criticalPrompt;
    case "aggressive": return config.aggressivePrompt;
    case "warn": return config.warnPrompt;
    default: return config.normalPrompt;
  }
}

function generateRuleText(config: OutputTokenControlConfig, level: PressureLevel): string {
  const strategy = getLevelStrategy(config, level);
  const custom = getLevelPrompt(config, level);
  const sentences = getSentences(config, level);

  if (strategy === "custom" && custom) return custom;

  const parts: string[] = [];
  switch (strategy) {
    case "sentence_limit":
      parts.push(`Answer in at most ${sentences} sentence${sentences > 1 ? "s" : ""}.`);
      break;
    case "char_limit": {
      const limit = level === "critical" && config.criticalSentences === 1 ? 200 : 500;
      parts.push(`Answer in at most ${limit} characters. Be extremely concise.`);
      break;
    }
    case "bullet_only":
      parts.push("Use bullet points only. No paragraphs or prose. Answer in at most 5 bullet points.");
      break;
    case "custom":
      if (custom) parts.push(custom);
      else parts.push("Be concise. Avoid verbose explanations.");
      break;
    case "concise":
    default:
      parts.push(`Be concise. Prefer bullet points. Answer in at most ${sentences} sentences.`);
      parts.push("Skip introductions, conclusions, and rambling unless explicitly asked.");
      break;
  }

  const charLimit = config.maxChars;
  if (charLimit > 0 && strategy !== "char_limit") {
    parts.push(`Keep the total response under ${charLimit} characters.`);
  }

  return parts.join(" ");
}

export function shouldExclude(config: OutputTokenControlConfig, userMessage: string): boolean {
  if (!config.excludePatterns || config.excludePatterns.length === 0) return false;
  for (const pat of config.excludePatterns) {
    try {
      if (new RegExp(pat, "i").test(userMessage)) return true;
    } catch { /* skip invalid regex */ }
  }
  return false;
}

export function getInjectionText(
  config: OutputTokenControlConfig,
  userMessage: string,
  pressureLevel?: PressureLevel,
): string | null {
  if (!config.enabled) return null;
  if (shouldExclude(config, userMessage)) return null;

  const mode = config.mode ?? "adaptive";

  if (mode === "off") return null;

  if (mode === "always-on") {
    return generateRuleText(config, "normal");
  }

  if (mode === "adaptive") {
    const level = pressureLevel ?? "normal";
    return generateRuleText(config, level);
  }

  return null;
}

export function estimatePressureLevel(
  apConfig: { enabled: boolean; warnThreshold: number; aggressiveThreshold: number; criticalThreshold: number } | undefined,
): PressureLevel {
  if (!apConfig?.enabled) return "normal";

  const state = (globalThis as Record<string, unknown>).__pressureState as { estimatedTokens: number; maxTokens: number } | undefined;
  if (!state) return "normal";

  const ratio = state.maxTokens > 0 ? state.estimatedTokens / state.maxTokens : 0;
  if (ratio >= apConfig.criticalThreshold) return "critical";
  if (ratio >= apConfig.aggressiveThreshold) return "aggressive";
  if (ratio >= apConfig.warnThreshold) return "warn";
  return "normal";
}

let lastLogKey = "";

export function getCompactionNudge(level: PressureLevel): string | null {
  switch (level) {
    case "warn":
      return "[Context notice: conversation is growing long. Run `context(mode='check')` to verify pressure. Keep responses concise — prefer short answers and summarize where possible.]";
    case "aggressive":
      return "[Context notice: approaching context limit. Run `context(mode='compress')` to compact older context. Be extremely concise. Use `memory(mode='search')` instead of reading files blind to save tokens.]";
    case "critical":
      return "[Context notice: near context limit. Run `context(mode='compress')` immediately, then `context(mode='recall')` to restore archived context. Respond in as few tokens as possible.]";
    default:
      return null;
  }
}

export function logOutputTokenInjection(level: PressureLevel, text: string): void {
  const key = `${level}|${text.slice(0, 80)}`;
  if (key === lastLogKey) return;
  lastLogKey = key;

  writeCompressLog({
    action: "output-token-control",
    strategy: "output-token-control",
    cmd_preview: "",
    original_chars: 0,
    compressed_chars: text.length,
    original_lines: 0,
    compressed_lines: 1,
    reduction_pct: 0,
    duration_ms: 0,
    failed: 0,
    level,
    rule_text: text.slice(0, 200),
  });
}
