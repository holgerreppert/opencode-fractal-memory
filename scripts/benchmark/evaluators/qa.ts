import { getCategoryLabel } from "../datasets/locomo";
import { type QAPair } from "../datasets/locomo";

export type SampleResult = {
  question: string;
  groundTruth: string;
  prediction: string;
  category: string;
  f1: number;
  evidenceChunks: number;
  latencyMs: number;
};

function computeF1(prediction: string, groundTruth: string): number {
  const normalize = (s: string): string[] => {
    if (typeof s !== "string") return [];
    return s.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  };

  const pred = normalize(prediction ?? "");
  const truth = normalize(groundTruth ?? "");

  if (pred.length === 0 && truth.length === 0) return 1;
  if (pred.length === 0 || truth.length === 0) return 0;

  const predSet = new Set(pred);
  const common = truth.filter(w => predSet.has(w)).length;

  if (common === 0) return 0;
  const precision = common / pred.length;
  const recall = common / truth.length;
  return (2 * precision * recall) / (precision + recall);
}

function computeAdversarialScore(prediction: string): number {
  const lower = (prediction ?? "").toLowerCase();
  const refusalPhrases = [
    "cannot determine",
    "cannot answer",
    "not mentioned",
    "not provided",
    "no information",
    "does not contain",
    "does not provide",
    "i cannot",
    "unable to",
    "not enough",
    "not specified",
    "not available",
  ];
  return refusalPhrases.some(p => lower.includes(p)) ? 1.0 : 0.0;
}

export function evaluateSample(
  qa: QAPair,
  prediction: string,
  evidenceChunks: number,
  latencyMs: number,
): SampleResult {
  const category = getCategoryLabel(qa.category);
  const f1 = qa.category === 5
    ? computeAdversarialScore(prediction)
    : computeF1(prediction, qa.answer);

  return { question: qa.question, groundTruth: qa.answer, prediction, category, f1, evidenceChunks, latencyMs };
}

export type CategorySummary = {
  f1: number;
  count: number;
};

export type BenchmarkReport = {
  timestamp: string;
  config: {
    dataset: string;
    topK: number;
    model: string;
  };
  overall_f1: number;
  categories: Record<string, CategorySummary>;
  total_questions: number;
  total_latency_ms: number;
  errors: string[];
};

export function buildReport(
  results: SampleResult[],
  config: { dataset: string; topK: number; model: string },
): BenchmarkReport {
  const byCat: Record<string, number[]> = {};
  const errors: string[] = [];
  let totalLatency = 0;

  for (const r of results) {
    (byCat[r.category] ??= []).push(r.f1);
    totalLatency += r.latencyMs;
    if (r.prediction.startsWith("[ERROR]") || r.prediction.startsWith("[HTTP")) {
      errors.push(r.question.substring(0, 100));
    }
  }

  const categories: Record<string, CategorySummary> = {};
  for (const [cat, scores] of Object.entries(byCat)) {
    categories[cat] = {
      f1: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    };
  }

  const allF1 = results.map(r => r.f1);

  return {
    timestamp: new Date().toISOString(),
    config: { dataset: config.dataset, topK: config.topK, model: config.model },
    overall_f1: allF1.reduce((a, b) => a + b, 0) / allF1.length,
    categories,
    total_questions: results.length,
    total_latency_ms: totalLatency,
    errors,
  };
}
