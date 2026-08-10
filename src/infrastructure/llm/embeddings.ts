import { Tokenizer } from "@huggingface/tokenizers";
import { InferenceSession, Tensor, SessionOptions, ensureOnnxRuntime } from "./onnx-runtime";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { homedir } from "os";
import { memLog } from "../../logging";

const MODELS_DIR = join(homedir(), ".config", "opencode", "models", "Xenova", "gte-small");
const MODEL_PATH = join(MODELS_DIR, "onnx", "model_quantized.onnx");
const TOKENIZER_JSON_PATH = join(MODELS_DIR, "tokenizer.json");
const TOKENIZER_CONFIG_PATH = join(MODELS_DIR, "tokenizer_config.json");
const MAX_LEN = 512;
const MAX_EMBED_CONTENT_CHARS = 100_000;
const HIDDEN_SIZE = 384;

const MINILM_DIR = join(homedir(), ".config", "opencode", "models", "Xenova", "all-MiniLM-L6-v2");
const MINILM_MAX_LEN = 256;

let session: InferenceSession | undefined;
let tokenizer: Tokenizer | undefined;
let miniLmSession: InferenceSession | undefined;
let miniLmTokenizer: Tokenizer | undefined;

function createSessionOptions(): SessionOptions {
  return {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    intraOpNumThreads: 0,
    enableCpuMemArena: true,
    extra: {
      session: { set_denormal_as_zero: "1" },
      optimization: { enable_gelu_approximation: "1" },
    },
  };
}

async function getSession(): Promise<InferenceSession> {
  if (!session) {
    await ensureOnnxRuntime();
    session = await InferenceSession.create(MODEL_PATH, createSessionOptions());
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

async function getMiniLMSession(): Promise<InferenceSession> {
  if (!miniLmSession) {
    await ensureOnnxRuntime();
    miniLmSession = await InferenceSession.create(
      join(MINILM_DIR, "onnx", "model_quantized.onnx"),
      createSessionOptions(),
    );
  }
  return miniLmSession;
}

async function loadMiniLMTokenizer(): Promise<Tokenizer> {
  if (!miniLmTokenizer) {
    const [tokenizerJsonRaw, tokenizerConfigRaw] = await Promise.all([
      readFile(join(MINILM_DIR, "tokenizer.json"), "utf-8"),
      readFile(join(MINILM_DIR, "tokenizer_config.json"), "utf-8"),
    ]);
    miniLmTokenizer = new Tokenizer(JSON.parse(tokenizerJsonRaw), JSON.parse(tokenizerConfigRaw));
  }
  return miniLmTokenizer!;
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

function prepareInput(ids: number[], mask: number[], maxLen = MAX_LEN) {
  const seqLen = Math.min(ids.length, maxLen);
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

async function embedOne(session: InferenceSession, tok: Tokenizer, text: string, maxLen: number = MAX_LEN): Promise<number[]> {
  const encoded = tok.encode(text);
  const { attnMask, seqLen, feeds } = prepareInput(encoded.ids as number[], encoded.attention_mask as number[], maxLen);
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

export interface EmbeddingSegments {
  primary: number[];
  segments: number[][];
}

const SEGMENT_OVERHEAD = 3;

export function splitContentForChunking(text: string, maxTokens: number, maxSegments: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (maxSegments <= 1) return [trimmed];
  if (!tokenizer) return [trimmed];

  const tok = getTokenizerSync();
  const maxBody = Math.max(1, maxTokens - SEGMENT_OVERHEAD);

  const paragraphs = trimmed.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  const units: string[] = [];
  for (const p of paragraphs) {
    if (tok.encode(p).ids.length <= maxBody) {
      units.push(p);
      continue;
    }
    const sentences = p.match(/[^.!?\n]+[.!?]*/g) ?? [p];
    for (const s of sentences) {
      const st = s.trim();
      if (st.length > 0) units.push(st);
    }
  }

  const lengths = units.map(u => tok.encode(u).ids.length);
  const segments: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const unitTokens = lengths[i]!;
    if (current.length > 0 && currentTokens + unitTokens + 2 > maxBody) {
      segments.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += unitTokens;
  }
  if (current.length > 0) segments.push(current.join("\n\n"));

  if (segments.length > maxSegments) {
    const kept = segments.slice(0, maxSegments - 1);
    const tail = segments.slice(maxSegments - 1).join("\n\n");
    kept.push(tail);
    return kept;
  }
  return segments;
}

export async function generateEmbeddingWithSegments(
  text: string,
  opts?: { maxTokens?: number; maxSegments?: number }
): Promise<EmbeddingSegments> {
  const maxTokens = opts?.maxTokens ?? MAX_LEN;
  const maxSegments = opts?.maxSegments ?? 8;
  if (text.length > MAX_EMBED_CONTENT_CHARS) {
    memLog("warn", "embeddings", "Skipping embedding — content too large to tokenize", {
      chars: text.length,
      maxChars: MAX_EMBED_CONTENT_CHARS,
    });
    throw new Error(`content too large to embed (${text.length} chars)`);
  }
  const [sess, tok] = await Promise.all([getSession(), loadTokenizer()]);
  const encoded = tok.encode(text);
  if (encoded.ids.length <= maxTokens || maxSegments <= 1) {
    const primary = await embedOne(sess, tok, text);
    return { primary, segments: [primary] };
  }
  const parts = splitContentForChunking(text, maxTokens, maxSegments);
  if (parts.length <= 1) {
    const primary = await embedOne(sess, tok, text);
    return { primary, segments: [primary] };
  }
  const segmentVectors: number[][] = [];
  for (const part of parts) {
    segmentVectors.push(await embedOne(sess, tok, part));
  }
  return { primary: segmentVectors[0]!, segments: segmentVectors };
}

export async function countContentSegments(text: string, maxTokens: number = MAX_LEN, maxSegments: number = 8): Promise<number> {
  const tok = await loadTokenizer();
  if (tok.encode(text).ids.length <= maxTokens || maxSegments <= 1) return 1;
  return splitContentForChunking(text, maxTokens, maxSegments).length;
}

export { cosineSimilarity } from "../../math";

export interface MiniLMEmbeddingResult {
  embedding: number[];
  segments: number[][];
}

export async function generateMiniLMEmbedding(text: string): Promise<MiniLMEmbeddingResult> {
  const [sess, tok] = await Promise.all([getMiniLMSession(), loadMiniLMTokenizer()]);
  const primary = await embedOne(sess, tok, text, MINILM_MAX_LEN);
  return { embedding: primary, segments: [primary] };
}
