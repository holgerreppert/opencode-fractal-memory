import { writeCompressLog } from "../logging";

export interface AdaptivePressureConfig {
  enabled: boolean;
  warnThreshold: number;
  aggressiveThreshold: number;
  criticalThreshold: number;
}

interface PressureState {
  estimatedTokens: number;
  maxTokens: number;
  warningsIssued: Set<string>;
  phase: "normal" | "warn" | "aggressive" | "critical";
}

let state: PressureState = {
  estimatedTokens: 0,
  maxTokens: 128000,
  warningsIssued: new Set(),
  phase: "normal",
};

export function resetPressureState(maxTokens?: number): void {
  state = {
    estimatedTokens: 0,
    maxTokens: maxTokens ?? 128000,
    warningsIssued: new Set(),
    phase: "normal",
  };
}

export function getPressurePhase(config: AdaptivePressureConfig): PressureState["phase"] {
  if (!config.enabled) return "normal";
  const ratio = state.maxTokens > 0 ? state.estimatedTokens / state.maxTokens : 0;
  if (ratio >= config.criticalThreshold) {
    state.phase = "critical";
  } else if (ratio >= config.aggressiveThreshold) {
    state.phase = "aggressive";
  } else if (ratio >= config.warnThreshold) {
    state.phase = "warn";
  } else {
    state.phase = "normal";
  }
  return state.phase;
}

export function estimateTokensForOutput(output: string): number {
  return Math.ceil(output.length / 4);
}

export function recordOutput(output: string, config: AdaptivePressureConfig): string | null {
  if (!config.enabled) return null;
  state.estimatedTokens += estimateTokensForOutput(output);

  const phase = getPressurePhase(config);
  let warning: string | null = null;

  if (phase === "critical" && !state.warningsIssued.has("critical")) {
    warning = "[Context critically full — consider compacting memory or starting fresh session]";
    state.warningsIssued.add("critical");
    writeCompressLog({
      action: "pressure-critical", strategy: "adaptive-pressure",
      cmd_preview: "", original_chars: 0, compressed_chars: 0,
      original_lines: 0, compressed_lines: 0,
      reduction_pct: 0, duration_ms: 0, failed: 0,
      estimated_tokens: state.estimatedTokens, max_tokens: state.maxTokens,
    });
  } else if (phase === "aggressive" && !state.warningsIssued.has("aggressive")) {
    warning = "[Context at aggressive threshold — compression will be stricter]";
    state.warningsIssued.add("aggressive");
    writeCompressLog({
      action: "pressure-aggressive", strategy: "adaptive-pressure",
      cmd_preview: "", original_chars: 0, compressed_chars: 0,
      original_lines: 0, compressed_lines: 0,
      reduction_pct: 0, duration_ms: 0, failed: 0,
      estimated_tokens: state.estimatedTokens, max_tokens: state.maxTokens,
    });
  } else if (phase === "warn" && !state.warningsIssued.has("warn")) {
    warning = `[Context at ~${Math.round(state.estimatedTokens / state.maxTokens * 100)}% — compression may become aggressive]`;
    state.warningsIssued.add("warn");
    writeCompressLog({
      action: "pressure-warn", strategy: "adaptive-pressure",
      cmd_preview: "", original_chars: 0, compressed_chars: 0,
      original_lines: 0, compressed_lines: 0,
      reduction_pct: 0, duration_ms: 0, failed: 0,
      estimated_tokens: state.estimatedTokens, max_tokens: state.maxTokens,
    });
  }

  return warning;
}

export function getEffectiveMaxLines(baseMaxLines: number, config: AdaptivePressureConfig): number {
  const phase = getPressurePhase(config);
  switch (phase) {
    case "critical": return Math.min(baseMaxLines, 5);
    case "aggressive": return Math.min(baseMaxLines, 20);
    case "warn": return Math.min(baseMaxLines, 35);
    default: return baseMaxLines;
  }
}

export function shouldSkipGeneric(phase: PressureState["phase"]): boolean {
  return phase === "aggressive" || phase === "critical";
}
