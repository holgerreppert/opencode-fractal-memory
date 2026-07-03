import { Tokenizer } from "@huggingface/tokenizers";
import { InferenceSession, Tensor, ensureOnnxRuntime } from "./onnx-runtime";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { homedir } from "os";

const MODELS_DIR = join(homedir(), ".config", "opencode", "models", "Xenova", "all-MiniLM-L6-v2");
const MODEL_PATH = join(MODELS_DIR, "onnx", "model_quantized.onnx");
const TOKENIZER_JSON_PATH = join(MODELS_DIR, "tokenizer.json");
const TOKENIZER_CONFIG_PATH = join(MODELS_DIR, "tokenizer_config.json");
const MAX_LEN = 256;
const HIDDEN_SIZE = 384;

let session: InferenceSession | undefined;
let tokenizer: Tokenizer | undefined;

async function getSession(): Promise<InferenceSession> {
  if (!session) {
    await ensureOnnxRuntime();
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
  }
  return session;
}

async function loadTokenizer(): Promise<Tokenizer> {
  if (!tokenizer) {
    const [tokenizerJsonRaw, tokenizerConfigRaw] = await Promise.all([
      readFile(TOKENIZER_JSON_PATH, "utf-8"),
      readFile(TOKENIZER_CONFIG_PATH, "utf-8"),
    ]);
    const tokenizerJson = JSON.parse(tokenizerJsonRaw);
    const tokenizerConfig = JSON.parse(tokenizerConfigRaw);
    tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  }
  return tokenizer!;
}

function getTokenizerSync(): Tokenizer {
  if (!tokenizer) {
    throw new Error("Tokenizer not loaded. Call loadTokenizer() first.");
  }
  return tokenizer;
}

function meanPool(output: Float32Array, mask: bigint[], seqLen: number): Float32Array {
  let count = 0;
  for (let i = 0; i < seqLen; i++) {
    if (mask[i]! === BigInt(1)) count++;
  }
  const pooled = new Float32Array(HIDDEN_SIZE);
  if (count === 0) return pooled;
  for (let i = 0; i < seqLen; i++) {
    if (mask[i]! === BigInt(1)) {
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        pooled[j]! += output[i * HIDDEN_SIZE + j]!;
      }
    }
  }
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    pooled[j]! /= count;
  }
  return pooled;
}

function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  const out = new Float32Array(HIDDEN_SIZE);
  for (let i = 0; i < HIDDEN_SIZE; i++) {
    out[i] = vec[i]! / norm;
  }
  return out;
}

function prepareInput(ids: number[], mask: number[]) {
  const seqLen = Math.min(ids.length, MAX_LEN);
  const inputIds = new BigInt64Array(seqLen);
  const attnMask = new BigInt64Array(seqLen);
  const tids = new BigInt64Array(seqLen);
  for (let i = 0; i < seqLen; i++) {
    inputIds[i] = BigInt(ids[i]!);
    attnMask[i] = BigInt(mask[i]!);
    tids[i] = BigInt(0);
  }
  return {
    inputIds,
    attnMask: attnMask as unknown as bigint[],
    seqLen,
    feeds: {
      input_ids: new Tensor("int64", inputIds, [1, seqLen]),
      attention_mask: new Tensor("int64", attnMask, [1, seqLen]),
      token_type_ids: new Tensor("int64", tids, [1, seqLen]),
    },
  };
}

async function embedOne(session: InferenceSession, tok: Tokenizer, text: string): Promise<number[]> {
  const encoded = tok.encode(text);
  const { attnMask, seqLen, feeds } = prepareInput(encoded.ids as number[], encoded.attention_mask as number[]);
  const results = await session.run(feeds);
  const output = results["last_hidden_state"];
  if (!output) throw new Error("No output from model");
  const lastHiddenState = output.data as Float32Array;
  const pooled = meanPool(lastHiddenState, attnMask, seqLen);
  const normalized = l2Normalize(pooled);
  return Array.from(normalized);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [sess, tok] = await Promise.all([getSession(), loadTokenizer()]);
  return embedOne(sess, tok, text);
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const [sess, tok] = await Promise.all([getSession(), loadTokenizer()]);
  if (texts.length <= 4) {
    return Promise.all(texts.map(t => embedOne(sess, tok, t)));
  }
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedOne(sess, tok, text));
  }
  return results;
}

export function estimateTokens(text: string): number {
  if (!tokenizer) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words * 1.5));
  }
  const tok = getTokenizerSync();
  const encoded = tok.encode(text);
  return encoded.ids.length;
}

export { cosineSimilarity } from "../../math";
