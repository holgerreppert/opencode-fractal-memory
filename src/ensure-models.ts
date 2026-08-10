import { mkdir, writeFile, access, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE = join(homedir(), ".config", "opencode", "models", "Xenova", "all-MiniLM-L6-v2");
const ONNX_DIR = join(BASE, "onnx");

const GTE_BASE = join(homedir(), ".config", "opencode", "models", "Xenova", "gte-small");
const GTE_ONNX_DIR = join(GTE_BASE, "onnx");

const CROSS_BASE = join(homedir(), ".config", "opencode", "models", "Xenova", "ms-marco-MiniLM-L-6-v2");
const CROSS_ONNX_DIR = join(CROSS_BASE, "onnx");

const FILES: { path: string; url: string }[] = [
  {
    path: join(ONNX_DIR, "model_quantized.onnx"),
    url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx",
  },
  {
    path: join(BASE, "tokenizer.json"),
    url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json",
  },
  {
    path: join(BASE, "tokenizer_config.json"),
    url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json",
  },
  {
    path: join(GTE_ONNX_DIR, "model_quantized.onnx"),
    url: "https://huggingface.co/Xenova/gte-small/resolve/main/onnx/model_quantized.onnx",
  },
  {
    path: join(GTE_BASE, "tokenizer.json"),
    url: "https://huggingface.co/Xenova/gte-small/resolve/main/tokenizer.json",
  },
  {
    path: join(GTE_BASE, "tokenizer_config.json"),
    url: "https://huggingface.co/Xenova/gte-small/resolve/main/tokenizer_config.json",
  },
  {
    path: join(CROSS_ONNX_DIR, "model_quantized.onnx"),
    url: "https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main/onnx/model_quantized.onnx",
  },
  {
    path: join(CROSS_BASE, "tokenizer.json"),
    url: "https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main/tokenizer.json",
  },
  {
    path: join(CROSS_BASE, "tokenizer_config.json"),
    url: "https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main/tokenizer_config.json",
  },
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  await writeFile(dest, new Uint8Array(buffer));
}

export async function ensureModels(): Promise<void> {
  await mkdir(ONNX_DIR, { recursive: true });
  await mkdir(GTE_ONNX_DIR, { recursive: true });
  await mkdir(CROSS_ONNX_DIR, { recursive: true });

  for (const f of FILES) {
    if (await fileExists(f.path)) continue;
    const name = f.url.split("/").pop();
    process.stdout.write(`Downloading ${name} ... `);
    await download(f.url, f.path);
    const stat = await import("node:fs/promises").then(m => m.stat(f.path));
    const mb = (stat.size / 1024 / 1024).toFixed(1);
    process.stdout.write(`${mb} MB\n`);
  }
}

export async function ensureAgentFiles(): Promise<void> {
  const srcAgent = join(__dirname, "..", "agent");
  const dstAgent = join(homedir(), ".config", "opencode", "agent");
  await mkdir(dstAgent, { recursive: true });
  await cp(srcAgent, dstAgent, { recursive: true, force: true });
}

export async function ensureCommandFiles(): Promise<void> {
  const srcCommands = join(__dirname, "..", "commands");
  const dstCommands = join(homedir(), ".config", "opencode", "commands");
  await mkdir(dstCommands, { recursive: true });
  await cp(srcCommands, dstCommands, { recursive: true, force: true });
}
