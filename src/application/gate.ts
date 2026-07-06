export interface ScoredCandidate {
  id: string;
  label: string;
  content: string;
  score: number;
  type?: string | null | undefined;
  level?: number | undefined;
}

export interface GateResult {
  selected: ScoredCandidate[];
  uncertain: boolean;
  gated: boolean;
}

export interface GateConfig {
  thresholds: Record<string, number>;
  defaultThreshold: number;
  deltaThreshold: number;
  gateTopN: number;
}

const DEFAULT_CONFIG: GateConfig = {
  thresholds: {
    rule: 0.5,
    fact: 0.4,
    howto: 0.4,
    concept: 0.35,
    note: 0.2,
    event: 0.15,
  },
  defaultThreshold: 0.3,
  deltaThreshold: 0.15,
  gateTopN: 5,
};

export function computeGate(
  candidates: ScoredCandidate[],
  config: Partial<GateConfig> = {},
): GateResult {
  if (candidates.length === 0) {
    return { selected: [], uncertain: false, gated: true };
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const sorted = [...candidates].sort((a, b) => b.score - a.score);

  // Check if all below threshold
  const aboveThreshold = sorted.filter(c => {
    const typeKey: string = c.type ?? "__none__";
    const threshold = cfg.thresholds[typeKey] ?? cfg.defaultThreshold;
    return c.score >= threshold;
  });

  if (aboveThreshold.length === 0) {
    return { selected: [], uncertain: true, gated: true };
  }

  // Check score gap (delta)
  const gateN = Math.min(cfg.gateTopN, sorted.length);
  const top1 = sorted[0]!.score;
  const topN = sorted[gateN - 1]!.score;
  const delta = top1 - topN;
  const uncertain = gateN > 1 && delta < cfg.deltaThreshold;

  return {
    selected: aboveThreshold,
    uncertain,
    gated: false,
  };
}
