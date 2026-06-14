import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

const DATA_PATH = path.join(__dirname, "data", "locomo10.json");

const CATEGORIES: Record<number, string> = {
  1: "single_hop",
  2: "multi_hop",
  3: "temporal",
  4: "commonsense",
  5: "adversarial",
};

type Turn = { speaker: string; dia_id: string; text: string };
type Conversation = {
  sample_id: string;
  conversation: Record<string, Turn[]>;
  qa: Array<{ question: string; answer: string; evidence: string[]; category: number }>;
};

const STOP_WORDS = new Set([
  "a","an","the","is","was","are","were","be","been","being","have","has","had",
  "do","does","did","will","would","can","could","shall","should","may","might",
  "i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","her","its","our","their","mine","yours","his","hers","its","ours","theirs",
  "this","that","these","those","in","on","at","to","for","of","with","by",
  "from","as","into","through","during","before","after","above","below","between",
  "and","but","or","nor","not","so","yet","both","either","neither",
  "what","which","who","whom","whose","when","where","why","how",
  "about","if","then","else","than","some","any","all","each","every","no","none","many",
  "much","more","most","few","less","own","same","such","here","there",
  "up","down","out","off","over","under","again","further","once","only","just",
  "also","very","too","really","please","tell","let","get","got","like",
]);

function keywordSearch(content: string, query: string): number {
  const qWords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const cLower = content.toLowerCase();
  return qWords.filter(w => cLower.includes(w)).length;
}

function computeF1(prediction: string, groundTruth: string): number {
  const normalize = (s: string) => {
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

async function main() {
  console.log("Loading LoCoMo dataset...");
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const data: Conversation[] = Object.values(JSON.parse(raw));
  console.log(`Loaded ${data.length} conversations`);

  const conv = data[0];
  console.log(`\nConversation: ${conv.sample_id}`);
  console.log(`Sessions: ${Object.keys(conv.conversation).length}`);
  console.log(`QA pairs: ${conv.qa.length}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "locomo-test-"));
  const dbPath = path.join(tmpDir, "memory.db");
  console.log(`\nTemp DB: ${dbPath}`);

  const { createSqliteMemoryStore } = await import("../../src/storage/sqlite");
  const store = createSqliteMemoryStore(tmpDir, dbPath);
  await store.ensureSeed();

  // Ingest all turns as nodes
  console.log("\nIngesting...");
  let turnCount = 0;
  for (const turns of Object.values(conv.conversation)) {
    for (const turn of turns) {
      await store.createNode({
        scope: "project",
        label: `${conv.sample_id}-${turn.dia_id}`,
        content: `${turn.speaker}: ${turn.text}`,
        type: "note",
        level: 0,
        embedding: null,
        metadata: { speaker: turn.speaker, turnId: turn.dia_id },
        importance: 0.5,
      });
      turnCount++;
    }
  }
  console.log(`Ingested ${turnCount} turns`);

  // Get the DB connection directly for keyword search
  const db = await (store as any).getDb("project");
  const results: Array<{ category: string; question: string; f1: number; evidence: string }> = [];
  const testQAs = conv.qa.slice(0, 5);

  console.log(`\n=== Testing ${testQAs.length} QA pairs ===\n`);

  for (const qa of testQAs) {
    console.log(`Q: ${qa.question}`);
    console.log(`Category: ${CATEGORIES[qa.category]}`);
    console.log(`Truth: ${qa.answer}`);

    // Keyword search: rank nodes by keyword match count
    const rows = db.query("SELECT id, content FROM memory_nodes WHERE scope = 'project'").all() as { id: string; content: string }[];
    const scored = rows
      .map(r => ({ ...r, score: keywordSearch(r.content, qa.question) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const topHits = scored.slice(0, 5);
    const evidence = topHits.map(r => r.content).join("\n");
    console.log(`Evidence hits: ${scored.length}, top ${topHits.length} used`);

    // Call Ollama
    const prompt = `Given this context from past conversations:
${evidence}

Answer this question concisely:
${qa.question}

If the context doesn't contain the answer, say "I cannot determine from the given context."`;

    let prediction = "";
    try {
      const resp = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.1:8b",
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });
      const body = await resp.json() as { message?: { content: string } };
      prediction = body.message?.content ?? "[no content]";
      console.log(`Prediction head: ${prediction.substring(0, 120)}`);
    } catch (err) {
      prediction = `[ERROR]`;
      console.log(`Ollama error: ${err}`);
    }

    const f1 = computeF1(prediction, qa.answer);
    results.push({ category: CATEGORIES[qa.category], question: qa.question, f1, evidence: prediction.substring(0, 80) });
    console.log(`F1: ${f1.toFixed(4)}`);
    console.log();
  }

  console.log("=== RESULTS ===\n");
  const byCat: Record<string, number[]> = {};
  for (const r of results) {
    (byCat[r.category] ??= []).push(r.f1);
  }
  for (const [cat, scores] of Object.entries(byCat)) {
    console.log(`${cat}: ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4)} (n=${scores.length})`);
  }
  const all = results.map(r => r.f1);
  console.log(`\nOverall: ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(4)} (n=${all.length})`);

  await store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => { console.error(err); process.exit(1); });
