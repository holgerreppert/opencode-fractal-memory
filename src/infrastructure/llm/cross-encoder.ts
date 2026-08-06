import { Tokenizer } from "@huggingface/tokenizers";
import { InferenceSession, Tensor, ensureOnnxRuntime } from "./onnx-runtime";
import { readFile, access } from "node:fs/promises";
import { join } from "path";
import { homedir } from "os";
import { memLog } from "../../logging";

const MODELS_DIR = join(homedir(), ".config", "opencode", "models", "Xenova", "ms-marco-MiniLM-L-6-v2");
const MODEL_PATH = join(MODELS_DIR, "onnx", "model_quantized.onnx");
const TOKENIZER_PATH = join(MODELS_DIR, "tokenizer.json");
const TOKENIZER_CONFIG_PATH = join(MODELS_DIR, "tokenizer_config.json");

let session: InferenceSession | undefined;
let tokenizer: Tokenizer | undefined;

async function getSession(): Promise<InferenceSession> {
  if (!session) {
    await ensureOnnxRuntime();
    try {
      await access(MODEL_PATH);
    } catch {
      memLog("error", "cross-encoder", "Cross-encoder model not found at " + MODEL_PATH + ". Run bun run src/ensure-models.ts to download it.");
      throw new Error("Cross-encoder model not found");
    }
    memLog("info", "cross-encoder", "Loading cross-encoder model", { path: MODEL_PATH });
    const t = performance.now();
    session = await InferenceSession.create(MODEL_PATH, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      intraOpNumThreads: 0,
      enableCpuMemArena: true,
      extra: {
        session: { set_denormal_as_zero: "1" },
        optimization: { enable_gelu_approximation: "1" },
      },
    });
    memLog("info", "cross-encoder", "Cross-encoder model loaded", { durationMs: (performance.now() - t).toFixed(1) });
  }
  return session;
}

async function loadTokenizer(): Promise<Tokenizer> {
  if (!tokenizer) {
    const [jsonRaw, configRaw] = await Promise.all([
      readFile(TOKENIZER_PATH, "utf-8"),
      readFile(TOKENIZER_CONFIG_PATH, "utf-8"),
    ]);
    tokenizer = new Tokenizer(JSON.parse(jsonRaw), JSON.parse(configRaw));
  }
  return tokenizer;
}

const CLS = 101;
const SEP = 102;
const MAX_LEN = 512;

function encodePair(tok: Tokenizer, a: string, b: string): { ids: number[]; mask: number[]; typeIds: number[] } {
  const encA = tok.encode(a);
  const encB = tok.encode(b);

  const idsA = encA.ids as number[];
  const idsB = encB.ids as number[];

  const ids = [CLS, ...idsA, SEP, ...idsB, SEP].slice(0, MAX_LEN);
  const seg1Len = Math.min(idsA.length + 2, MAX_LEN);
  const mask = ids.map(() => 1);
  const typeIds = ids.map((_, i) => (i < seg1Len ? 0 : 1));

  return { ids, mask, typeIds };
}

export interface CrossEncoderResult {
  id: string;
  score: number;
}

export interface ScorePairsOutput {
  topResults: CrossEncoderResult[];
  allScores: { id: string; score: number }[];
}

export async function scorePairs(
  query: string,
  candidates: Array<{ id: string; content: string }>,
  topK: number
): Promise<ScorePairsOutput> {
  memLog("debug", "cross-encoder", "Scoring pairs", { queryLength: query.length, candidateCount: candidates.length, topK });

  const _start = performance.now();
  const [_session, tok] = await Promise.all([getSession(), loadTokenizer()]);
  const loadTime = performance.now() - _start;
  const results: CrossEncoderResult[] = [];

  if (candidates.length === 0) {
    return { topResults: [], allScores: [] };
  }

  const pairs = candidates.map(c => {
    const docText = c.content.slice(0, 500);
    return { id: c.id, pair: encodePair(tok, query, docText) };
  });
  const maxLen = Math.max(...pairs.map(p => p.pair.ids.length));

  const inputIds = new BigInt64Array(pairs.length * maxLen);
  const mask = new BigInt64Array(pairs.length * maxLen);
  const tids = new BigInt64Array(pairs.length * maxLen);
  for (let b = 0; b < pairs.length; b++) {
    const p = pairs[b]!;
    const { ids, mask: m, typeIds } = p.pair;
    const offset = b * maxLen;
    for (let i = 0; i < ids.length; i++) {
      inputIds[offset + i] = BigInt(ids[i] ?? 0);
      mask[offset + i] = BigInt(m[i] ?? 0);
      tids[offset + i] = BigInt(typeIds[i] ?? 0);
    }
    for (let i = ids.length; i < maxLen; i++) {
      mask[offset + i] = 0n;
    }
  }

  const feeds: Record<string, Tensor> = {
    input_ids: new Tensor("int64", inputIds, [pairs.length, maxLen]),
    attention_mask: new Tensor("int64", mask, [pairs.length, maxLen]),
    token_type_ids: new Tensor("int64", tids, [pairs.length, maxLen]),
  };

  const output = await _session.run(feeds);
  const outputKeys = Object.keys(output);
  const logits = output["logits"] ?? output["score"] ?? (outputKeys[0] ? output[outputKeys[0]] : undefined);
  if (!logits) {
    memLog("warn", "cross-encoder", "No logits output from model", { outputs: outputKeys });
    return { topResults: [], allScores: candidates.map(c => ({ id: c.id, score: 0 })) };
  }

  const data = logits.data as Float32Array;
  for (let b = 0; b < pairs.length; b++) {
    const p = pairs[b]!;
    const logitRelevant = data.length >= pairs.length * 2 ? (data[b * 2 + 1] ?? data[b] ?? 0) : (data[b] ?? 0);
    const logitNonRelevant = data.length >= pairs.length * 2 ? (data[b * 2] ?? 0) : 0;
    const maxLogit = Math.max(logitNonRelevant, logitRelevant);
    const expRel = Math.exp(logitRelevant - maxLogit);
    const expNon = Math.exp(logitNonRelevant - maxLogit);
    const score = expRel / (expRel + expNon);
    results.push({ id: p.id, score });
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, topK);
  const allScores = results.map(r => ({ id: r.id, score: r.score }));
  const totalTime = (performance.now() - _start).toFixed(1);
  memLog("info", "cross-encoder", "Scoring complete", {
    candidateCount: candidates.length,
    topK,
    topScores: top.map(r => ({ id: r.id.slice(0, 12), score: r.score.toFixed(4) })),
    loadTimeMs: loadTime.toFixed(1),
    totalTimeMs: totalTime,
  });
  return { topResults: top, allScores };
}
