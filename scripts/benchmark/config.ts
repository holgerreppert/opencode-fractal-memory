export type BenchmarkConfig = {
  dataset: string;
  topK: number;
  answererModel: string;
  answererUrl: string;
  out: string;
  sample: number;
  resume: boolean;
  compress: boolean;
};

export function parseArgs(): BenchmarkConfig {
  const args = process.argv.slice(2);
  const get = (flag: string, defaultVal: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : defaultVal;
  };
  const has = (flag: string): boolean => args.includes(flag);

  return {
    dataset: get("--dataset", "./scripts/benchmark/data/locomo10.json"),
    topK: parseInt(get("--top-k", "20"), 10),
    answererModel: get("--answerer-model", "llama3.1:8b"),
    answererUrl: get("--answerer-url", "http://localhost:11434/api/chat"),
    out: get("--out", "./scripts/benchmark/reports/baseline.json"),
    sample: parseInt(get("--sample", "0"), 10),
    resume: has("--resume"),
    compress: has("--compress"),
  };
}

export function printHelp(): void {
  console.log(`
LoCoMo Benchmark Runner

Usage:
  bun run scripts/benchmark/run.ts [options]

Options:
  --dataset <path>       LoCoMo JSON path (default: ./scripts/benchmark/data/locomo10.json)
  --top-k <n>            Evidence candidates per query (default: 20)
  --answerer-model <m>   Ollama model name (default: llama3.1:8b)
  --answerer-url <url>   Ollama API URL (default: http://localhost:11434/api/chat)
  --out <path>           Output report path (default: ./scripts/benchmark/reports/baseline.json)
  --sample <n>           Run on N questions only (default: 0 = all)
  --resume               Resume from last checkpoint
  --compress             Run compression after each conversation ingest
  --help                 Print this help
`);
}
