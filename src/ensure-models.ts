import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "path";
import { homedir } from "os";

const BASE = join(homedir(), ".config", "opencode", "models", "Xenova", "all-MiniLM-L6-v2");
const ONNX_DIR = join(BASE, "onnx");

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
  let needsDownload = false;
  for (const f of FILES) {
    if (!(await fileExists(f.path))) {
      needsDownload = true;
      break;
    }
  }

  if (!needsDownload) return;

  await mkdir(ONNX_DIR, { recursive: true });

  for (const f of FILES) {
    const name = f.url.split("/").pop();
    process.stdout.write(`Downloading ${name} ... `);
    await download(f.url, f.path);
    const stat = await import("node:fs/promises").then(m => m.stat(f.path));
    const mb = (stat.size / 1024 / 1024).toFixed(1);
    process.stdout.write(`${mb} MB\n`);
  }
}
