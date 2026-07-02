import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs, printHelp } from "./config";
import { loadDataset, type QAPair } from "./datasets/locomo";
import { ingestConversation, cleanupIngested, type IngestedStore } from "./pipeline/ingest";
import { retrieveEvidence } from "./pipeline/retrieve";
import { getAnswer } from "./pipeline/answer";
import { evaluateSample, buildReport, type SampleResult } from "./evaluators/qa";

type CheckpointData = {
  conversationIndex: number;
  qaIndex: number;
  results: SampleResult[];
};

function loadCheckpoint(config: { out: string }): CheckpointData | null {
  const cpPath = config.out + ".checkpoint";
  if (!fs.existsSync(cpPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cpPath, "utf-8"));
  } catch {
    return null;
  }
}

function saveCheckpoint(out: string, data: CheckpointData): void {
  const dir = path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out + ".checkpoint", JSON.stringify(data, null, 2));
}

function clearCheckpoint(out: string): void {
  try { fs.unlinkSync(out + ".checkpoint"); } catch { /* ignore */ }
}

async function processQA(
  qa: QAPair,
  ingested: IngestedStore,
  config: { topK: number; answererModel: string; answererUrl: string },
): Promise<SampleResult> {
  const evidence = await retrieveEvidence(ingested.store, qa.question, config.topK, ingested.turnIndex, ingested.sessions);
  const evidenceText = evidence.map(e => e.content).join("\n");

  const { prediction, latencyMs } = await getAnswer(
    qa.question, evidenceText, config.answererUrl, config.answererModel,
  );
  return evaluateSample(qa, prediction, evidence.length, latencyMs);
}

async function main(): Promise<void> {
  const config = parseArgs();

  if (process.argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  if (!fs.existsSync(config.dataset)) {
    console.error(`Dataset not found: ${config.dataset}`);
    console.error("Download it first:");
    console.error("  curl -sL https://raw.githubusercontent.com/snap-research/LoCoMo/main/data/locomo10.json -o scripts/benchmark/data/locomo10.json");
    process.exit(1);
  }

  console.log(`Loading dataset: ${config.dataset}`);
  const conversations = loadDataset(config.dataset);
  console.log(`Loaded ${conversations.length} conversations`);

  // Sample: if --sample is set, spread questions evenly across all conversations
  if (config.sample > 0) {
    let totalQAs = 0;
    for (const c of conversations) totalQAs += c.qa.length;
    const perConv = Math.max(1, Math.ceil(config.sample / conversations.length));
    console.log(`Sample mode: ${config.sample} questions (${perConv} per conversation, total ${totalQAs} available)`);
    for (const c of conversations) {
      c.qa = c.qa.slice(0, perConv);
    }
  }

  // Resolve checkpoint
  let startConvIdx = 0;
  let allResults: SampleResult[] = [];
  if (config.resume) {
    const cp = loadCheckpoint(config);
    if (cp) {
      startConvIdx = cp.conversationIndex;
      allResults = cp.results;
      console.log(`Resuming from conversation ${cp.conversationIndex}, QA ${cp.qaIndex} (${allResults.length} results so far)`);
    }
  }

  // Conversation summaries for report
  let totalQuestions = 0;
  let totalLatency = 0;

  for (let ci = startConvIdx; ci < conversations.length; ci++) {
    const conv = conversations[ci]!;
    console.log(`\n[${ci + 1}/${conversations.length}] ${conv.sample_id} (${conv.qa.length} QA pairs)`);

    // Skip conversations we've already finished
    let startQaIdx = 0;
    if (config.resume && ci === startConvIdx && allResults.length > 0) {
      // Find where we left off in this conversation
      startQaIdx = allResults.filter(r => r.question.length > 0).length % Math.max(1, conv.qa.length);
    }

    const ingested = await ingestConversation(conv, config.compress);

    for (let qi = startQaIdx; qi < conv.qa.length; qi++) {
      const qa = conv.qa[qi]!;
      const result = await processQA(qa, ingested, config);
      allResults.push(result);
      totalQuestions++;
      totalLatency += result.latencyMs;

      const eta = conv.qa.length > 5 ? ` (ETA: ${((conv.qa.length - qi) * result.latencyMs / 1000 / 60).toFixed(1)}m)` : "";
      const f1Str = result.f1.toFixed(4);
      const cat = result.category.padEnd(12);
      console.log(`  [${qi + 1}/${conv.qa.length}] ${cat} F1: ${f1Str}${eta}`);

      // Checkpoint after each question
      if (ci === startConvIdx || allResults.length % 10 === 0) {
        saveCheckpoint(config.out, { conversationIndex: ci, qaIndex: qi + 1, results: allResults });
      }
    }

    await cleanupIngested(ingested);
    saveCheckpoint(config.out, { conversationIndex: ci + 1, qaIndex: 0, results: allResults });
  }

  // Build and save report
  const report = buildReport(allResults, {
    dataset: config.dataset,
    topK: config.topK,
    model: config.answererModel,
  });

  const dir = path.dirname(config.out);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.out, JSON.stringify(report, null, 2));
  clearCheckpoint(config.out);

  console.log(`\n=== Report saved to ${config.out} ===`);
  console.log(`Overall F1: ${(report.overall_f1 * 100).toFixed(2)}% (${report.total_questions} questions)`);
  for (const [cat, summary] of Object.entries(report.categories)) {
    console.log(`  ${cat.padEnd(16)} ${(summary.f1 * 100).toFixed(2)}% (n=${summary.count})`);
  }
  if (report.errors.length > 0) {
    console.log(`\nErrors: ${report.errors.length}`);
  }
}

main().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
