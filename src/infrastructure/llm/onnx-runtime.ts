import type { InferenceSession as IS, Tensor as T } from "onnxruntime-node";
import { memLog } from "../../logging";

export type InferenceSession = IS;
export type Tensor = T;

export let InferenceSession: typeof IS;
export let Tensor: typeof T;
export let runtimeName: "node" | "web" | null = null;

export async function ensureOnnxRuntime(): Promise<void> {
  if (runtimeName) return;

  try {
    const mod = await import("onnxruntime-node");
    InferenceSession = mod.InferenceSession;
    Tensor = mod.Tensor;
    runtimeName = "node";
    memLog("info", "onnx-runtime", "Using onnxruntime-node");
  } catch {
    try {
      const mod = await import("onnxruntime-web");
      InferenceSession = mod.InferenceSession;
      Tensor = mod.Tensor;
      runtimeName = "web";
      memLog("info", "onnx-runtime", "onnxruntime-node unavailable, fell back to onnxruntime-web");
    } catch {
      memLog("error", "onnx-runtime", "Neither onnxruntime-node nor onnxruntime-web could be loaded");
      throw new Error("No ONNX runtime available");
    }
  }
}

export function getRuntimeInfo() {
  return {
    runtime: runtimeName ?? "uninitialized",
    backend: "cpu",
    graphOptimizationLevel: "all",
    intraOpNumThreads: 0,
    enableCpuMemArena: true,
    extra: {
      session: { set_denormal_as_zero: "1" },
      optimization: { enable_gelu_approximation: "1" },
    },
    model: "all-MiniLM-L6-v2",
    dimensions: 384,
    crossEncoderModel: "ms-marco-MiniLM-L-6-v2",
    tokenizer: "@huggingface/tokenizers",
  };
}
