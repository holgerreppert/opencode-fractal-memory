/**
 * P1 of the intent usefulness-vector plan (approved 2026-09-07):
 * a heuristic, NO-LLM classifier that maps an agent-declared free-text
 * intent line onto the 8-intent task taxonomy.
 *
 * Input is `intent_lines.raw_text` — the line WITHOUT the `intent:`
 * prefix (stripped by the observer at capture time). Scoring is
 * per-pattern-entry: the FIRST match of an entry contributes its weight,
 * the highest total wins, ties break toward the earlier match position.
 * `confidence` = winning score / total score (rounded, 0 = no signal).
 */

export const INTENT_ORDER = [
  "debug",
  "implement",
  "understand",
  "plan",
  "verify",
  "research",
  "decide",
  "reflect",
] as const;

export type TaskIntent = (typeof INTENT_ORDER)[number];

interface IntentPattern {
  re: RegExp;
  w: number;
}

const PATTERNS: Record<TaskIntent, IntentPattern[]> = {
  debug: [
    { re: /\b(debug\w*|bug|fix\w*|error\w*|fail\w*|broken|crash\w*|traceback|exception\w*|regression\w*|404|500|not working|doesn'?t work|root.?cause)\b/gi, w: 2 },
    { re: /\bdiagnos\w*\b/gi, w: 1 },
  ],
  implement: [
    { re: /\b(implement\w*|build\w*|creat\w*|add(?:s|ed|ing)?|writ\w*|cod\w*|port\w*|refactor\w*|integrat\w*|wire|module\w*|feature\w*)\b/gi, w: 2 },
    { re: /\b(commit\w*|branch\w*|merg\w*|push\w*|publish\w*|releas\w*|deploy\w*|upgrad\w*|install\w*)\b/gi, w: 1 },
  ],
  understand: [
    { re: /\b(understand\w*|expla\w*|how does|why (?:is|does|do|are)|figure (?:out|it)|grasp\w*|concept\w*)\b/gi, w: 2 },
    { re: /\b(inspect\w*|analys\w*|analyz\w*|investigat\w*|review\w*|reading|look(?:ing)? (?:at|into))\b/gi, w: 1 },
  ],
  plan: [
    { re: /\b(plan\w*|design\w*|architect\w*|roadmap\w*|organiz\w*|prepar\w*|scaffold\w*|blueprint\w*|strateg\w*|steps for)\b/gi, w: 2 },
  ],
  verify: [
    { re: /\b(verif\w*|test\w*|confirm\w*|validat\w*|assert\w*|sanity|smoke\w*|qa)\b/gi, w: 2 },
    { re: /\b(check\w*|lint\w*|typecheck\w*|tsc|benchmark\w*|coverage|reproduc\w*)\b/gi, w: 1 },
  ],
  research: [
    { re: /\b(search\w*|find(?:ing)? out|research\w*|fetch\w*|look(?:ing)? up)\b/gi, w: 2 },
    { re: /\b(docs?|documentation|official|reference|paper\w*|specs?|upstream|google|stackoverflow)\b/gi, w: 1 },
  ],
  decide: [
    { re: /\b(decid\w*|choos\w*|option\w*|trade-?offs?|alternatives?|weigh\w*|prefer\w*)\b/gi, w: 2 },
    { re: /\b(compar\w*|which (?:one|should|approach)|between)\b/gi, w: 1 },
  ],
  reflect: [
    { re: /\b(summar\w*|retro\w*|distill\w*|consolidat\w*|changelog\w*|journall?ing)\b/gi, w: 2 },
    { re: /\b(stor\w+|record\w+|archiv\w+|captur\w+)\b[^.\n]*\b(memory|hub|journal|node|lesson)\b/gi, w: 2 },
    { re: /\b(memory|lessons?|knowledge|session log)\b/gi, w: 1 },
  ],
};

/** No signal at all → plain implementation work (the agent's modal task). */
const FALLBACK: TaskIntent = "implement";

export interface IntentClassification {
  intent: TaskIntent;
  /** Winning score / total score, rounded to 2 decimals. 0 = no signal. */
  confidence: number;
  scores: Record<TaskIntent, number>;
}

export function classifyIntent(text: string): IntentClassification {
  const scores = {} as Record<TaskIntent, number>;
  const firstIndex = {} as Partial<Record<TaskIntent, number>>;
  for (const intent of INTENT_ORDER) scores[intent] = 0;

  const input = text ?? "";
  let total = 0;
  for (const intent of INTENT_ORDER) {
    for (const { re, w } of PATTERNS[intent]) {
      re.lastIndex = 0;
      const m = re.exec(input);
      if (!m) continue;
      scores[intent] += w;
      total += w;
      if (firstIndex[intent] === undefined || m.index < firstIndex[intent]!) {
        firstIndex[intent] = m.index;
      }
    }
  }

  if (total === 0) {
    return { intent: FALLBACK, confidence: 0, scores };
  }

  let best = FALLBACK;
  let bestScore = -1;
  let bestIndex = Number.MAX_SAFE_INTEGER;
  for (const intent of INTENT_ORDER) {
    const score = scores[intent];
    const index = firstIndex[intent] ?? Number.MAX_SAFE_INTEGER;
    if (score > bestScore || (score === bestScore && index < bestIndex)) {
      best = intent;
      bestScore = score;
      bestIndex = index;
    }
  }

  return { intent: best, confidence: Math.round((bestScore / total) * 100) / 100, scores };
}

export interface IntentDistributionResult {
  counts: Record<TaskIntent, number>;
  total: number;
  /** Normalized share per intent (sums to 1, 0 when empty). */
  distribution: Record<TaskIntent, number>;
  /** Rows classified below 0.5 confidence — the weakest signal. */
  lowConfidence: number;
}

export function intentDistribution(texts: string[]): IntentDistributionResult {
  const counts = {} as Record<TaskIntent, number>;
  for (const intent of INTENT_ORDER) counts[intent] = 0;

  let lowConfidence = 0;
  for (const text of texts) {
    const c = classifyIntent(text);
    counts[c.intent] += 1;
    if (c.confidence < 0.5) lowConfidence += 1;
  }

  const total = texts.length;
  const distribution = {} as Record<TaskIntent, number>;
  for (const intent of INTENT_ORDER) {
    distribution[intent] = total > 0 ? counts[intent] / total : 0;
  }

  return { counts, total, distribution, lowConfidence };
}
