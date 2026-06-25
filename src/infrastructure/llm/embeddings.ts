import { InferenceSession, Tensor } from "onnxruntime-web";
import { Tokenizer } from "@huggingface/tokenizers";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { homedir } from "os";

const MODELS_DIR = join(homedir(), ".config", "opencode", "models", "Xenova", "all-MiniLM-L6-v2");
const MODEL_PATH = join(MODELS_DIR, "onnx", "model_quantized.onnx");
const TOKENIZER_JSON_PATH = join(MODELS_DIR, "tokenizer.json");
const TOKENIZER_CONFIG_PATH = join(MODELS_DIR, "tokenizer_config.json");

let session: InferenceSession | undefined;
let tokenizer: Tokenizer | undefined;

async function getSession(): Promise<InferenceSession> {
  if (!session) {
    session = await InferenceSession.create(MODEL_PATH, {
      executionProviders: ["wasm"],
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

// Synchronous version for internal use (tokenizer must be loaded first)
function getTokenizerSync(): Tokenizer {
  if (!tokenizer) {
    throw new Error("Tokenizer not loaded. Call loadTokenizer() first.");
  }
  return tokenizer;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [session, tok] = await Promise.all([
    getSession(),
    loadTokenizer()
  ]);

  const encoded = tok.encode(text);
  const ids = encoded.ids as number[];
  const attentionMask = encoded.attention_mask as number[];

  const seqLen = Math.min(ids.length, 256);

  const inputIds = new BigInt64Array(seqLen);
  const mask = new BigInt64Array(seqLen);
  for (let i = 0; i < seqLen; i++) {
    inputIds[i] = BigInt(ids[i]!);
    mask[i] = BigInt(attentionMask[i]!);
  }

  const feeds: Record<string, Tensor> = {
    input_ids: new Tensor("int64", inputIds, [1, seqLen]),
    attention_mask: new Tensor("int64", mask, [1, seqLen]),
    token_type_ids: new Tensor("int64", new BigInt64Array(seqLen), [1, seqLen]),
  };

  const results = await session.run(feeds);
  const output = results["last_hidden_state"];
  if (!output) throw new Error("No output from model");

  const lastHiddenState = output.data as Float32Array;
  const hiddenSize = 384;

  let count = 0;
  for (let i = 0; i < seqLen; i++) {
    if (mask[i] === BigInt(1)) count++;
  }

  const pooled: number[] = new Array<number>(hiddenSize).fill(0);
  for (let i = 0; i < seqLen; i++) {
    if (mask[i] === BigInt(1)) {
      for (let j = 0; j < hiddenSize; j++) {
        pooled[j] = (pooled[j] ?? 0) + (lastHiddenState[i * hiddenSize + j] ?? 0);
      }
    }
  }

  if (count > 0) {
    for (let j = 0; j < hiddenSize; j++) {
      pooled[j] = (pooled[j] ?? 0) / count;
    }
  }

  let norm = 0;
  for (const v of pooled) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);

  const normalized: number[] = [];
  if (norm > 0) {
    for (const v of pooled) {
      normalized.push(v / norm);
    }
  }

  return normalized;
}

export function estimateTokens(text: string): number {
  // If the tokenizer hasn't been loaded (e.g., in unit tests), fall back to a simple word‑count heuristic.
  if (!tokenizer) {
    // Approximate token count as 1.5 tokens per whitespace‑separated word.
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words * 1.5));
  }
  const tok = getTokenizerSync();
  const encoded = tok.encode(text);
  return encoded.ids.length;
}

export { cosineSimilarity } from "../../math";
