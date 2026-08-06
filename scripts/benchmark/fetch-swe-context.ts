import * as fs from "node:fs";
import * as path from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet/src/node.js";

/**
 * One-time fetch of SWE-ContextBench Lite data from the upstream repo.
 *
 * Downloads:
 *  - 99 related task JSONs (cases/SWEContextBench Lite/)
 *  - 300 trajectory JSONLs (cases/SWEContextBench Lite Past Experience/)
 *  - the relationship parquet (SWEContextBench_Relationship.parquet)
 *
 * Writes compact committed dataset (to tests/dbs/swe-contextbench/):
 *  - related.json       (99 related tasks: instance_id, repo, problem_statement, base_commit)
 *  - experience.json    (300 experience tasks: instance_id, repo, summary, problem_statement,
 *                        touched files derived from trajectory tool calls)
 *  - relationship.json  (related_instance_id -> experience_instance_id[] links)
 *
 * Raw downloads land in OUT_DIR/raw (gitignored, scripts/benchmark/data/swe-context/raw).
 * The compact JSONs are committed so the test never needs network access.
 */

const BASE = "https://raw.githubusercontent.com/jiayuanz3/SWEContextBench/main/cases";
const API = "https://api.github.com/repos/jiayuanz3/SWEContextBench/contents";
const OUT_DIR = path.resolve(__dirname, "../../scripts/benchmark/data/swe-context");
const COMMIT_DIR = path.resolve(__dirname, "../../tests/dbs/swe-contextbench");
const RAW_DIR = path.join(OUT_DIR, "raw");
const LITE_DIR = encodeURIComponent("SWEContextBench Lite");
const PE_DIR = encodeURIComponent("SWEContextBench Lite Past Experience");
const REL_PARQUET = "https://huggingface.co/datasets/jiayuanz3/SWEContextBench/resolve/main/data/SWEContextBench_Relationship.parquet";

const UA = { "User-Agent": "opencode-fractal-memory-benchmark" };

type RelatedTask = {
  instance_id: string;
  repo: string;
  problem_statement: string;
  base_commit: string;
};

type ExperienceTask = {
  instance_id: string;
  repo: string;
  summary: string;
  problem_statement: string;
  touched_files: string[];
  /** Agent's thinking-block narrative (root-cause analysis), concatenated + capped. */
  reasoning: string;
  /** Ordered tool-call trace: {name, target} where target = file path or command head. */
  tool_sequence: Array<{ name: string; target: string }>;
};

const REASONING_CAP = 2500;
const TOOL_SEQUENCE_CAP = 12;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function listDir(dir: string): Promise<string[]> {
  const items = (await fetchJson(`${API}/cases/${dir}`)) as Array<{ name: string }>;
  return items.map(i => i.name);
}

function extractInstanceId(problemStatement: string): string | null {
  const m = problemStatement.match(/instance_id:\s*([\w.-]+)/);
  return m ? m[1] : null;
}

function extractTouchedFiles(jsonl: string): string[] {
  const files = new Set<string>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as {
        type?: string;
        message?: { content?: unknown[] };
        snapshot?: { trackedFileBackups?: Record<string, unknown> };
      };
      if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          const b = block as { type?: string; name?: string; input?: { file_path?: string } };
          if (b.type === "tool_use" && typeof b.input?.file_path === "string") {
            const p = b.input.file_path.replace(/^\.\/swebench_\d+\/testbed\/[^/]+\/[^/]+\//, "");
            if (p && !p.includes("..")) files.add(p);
          }
        }
      }
      if (entry.type === "file-history-snapshot" && entry.snapshot?.trackedFileBackups) {
        for (const f of Object.keys(entry.snapshot.trackedFileBackups)) {
          files.add(f.replace(/^\.\/swebench_\d+\/testbed\/[^/]+\/[^/]+\//, ""));
        }
      }
    } catch {
      // skip malformed line
    }
  }
  return [...files];
}

function extractReasoning(jsonl: string): string {
  const blocks: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as {
        type?: string;
        message?: { content?: unknown[] };
      };
      if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
      for (const block of entry.message.content) {
        const b = block as { type?: string; thinking?: string };
        if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
          blocks.push(b.thinking.trim());
        }
      }
    } catch {
      // skip malformed line
    }
  }
  const joined = blocks.join("\n\n");
  return joined.length > REASONING_CAP ? joined.slice(0, REASONING_CAP) : joined;
}

function extractToolSequence(jsonl: string): Array<{ name: string; target: string }> {
  const seq: Array<{ name: string; target: string }> = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim() || seq.length >= TOOL_SEQUENCE_CAP) break;
    try {
      const entry = JSON.parse(line) as {
        type?: string;
        message?: { content?: unknown[] };
      };
      if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
      for (const block of entry.message.content) {
        if (seq.length >= TOOL_SEQUENCE_CAP) break;
        const b = block as { type?: string; name?: string; input?: Record<string, unknown> };
        if (b.type !== "tool_use" || !b.name || !b.input) continue;
        const input = b.input as { file_path?: string; command?: string; query?: string; path?: string };
        const raw = input.file_path ?? input.path ?? input.command ?? input.query ?? "";
        const target = String(raw).replace(/^\.\/swebench_\d+\/testbed\/[^/]+\/[^/]+\//, "").slice(0, 120);
        if (target) seq.push({ name: b.name, target });
      }
    } catch {
      // skip malformed line
    }
  }
  return seq;
}

async function main(): Promise<void> {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  console.log("1/4 downloading related task JSONs...");
  const relatedNames = (await listDir(LITE_DIR)).filter(n => n.endsWith(".json"));
  const related: RelatedTask[] = [];
  for (const name of relatedNames) {
    const raw = (await fetchJson(`${BASE}/${LITE_DIR}/${encodeURIComponent(name)}`)) as {
      instance_id: string;
      repo: string;
      problem_statement: string;
      base_commit: string;
    };
    related.push({
      instance_id: raw.instance_id,
      repo: raw.repo,
      problem_statement: raw.problem_statement,
      base_commit: raw.base_commit,
    });
  }
  related.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
  fs.writeFileSync(path.join(RAW_DIR, "related.json"), JSON.stringify(related, null, 1));
  console.log(`  ${related.length} related tasks`);

  console.log("2/4 downloading trajectory JSONLs...");
  const peNames = (await listDir(PE_DIR)).filter(n => n.endsWith(".jsonl"));
  const experience: ExperienceTask[] = [];
  for (const name of peNames) {
    const jsonl = await fetchText(`${BASE}/${PE_DIR}/${encodeURIComponent(name)}`);
    const lines = jsonl.split("\n").filter(Boolean);
    const summaryLine = lines.find(l => l.includes('"type":"summary"'));
    const summary = summaryLine ? (JSON.parse(summaryLine) as { summary?: string }).summary ?? "" : "";
    let problem_statement = "";
    let instance_id = "";
    for (const line of lines) {
      if (line.includes("instance_id:")) {
        const entry = JSON.parse(line) as { message?: { content?: unknown } };
        const content = entry.message?.content;
        if (typeof content === "string") {
          problem_statement = content;
          instance_id = extractInstanceId(content) ?? "";
          if (instance_id) break;
        }
      }
    }
    const repo = instance_id.replace(/__.*/, "").replace(/_/g, "/");
    experience.push({
      instance_id,
      repo,
      summary,
      problem_statement,
      touched_files: extractTouchedFiles(jsonl),
      reasoning: extractReasoning(jsonl),
      tool_sequence: extractToolSequence(jsonl),
    });
  }
  experience.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
  fs.writeFileSync(path.join(RAW_DIR, "experience.json"), JSON.stringify(experience, null, 1));
  console.log(`  ${experience.length} experience trajectories`);

  console.log("3/4 downloading + parsing relationship parquet...");
  const parquetPath = path.join(RAW_DIR, "SWEContextBench_Relationship.parquet");
  const res = await fetch(REL_PARQUET, { headers: UA });
  if (!res.ok) throw new Error(`GET relationship parquet -> ${res.status}`);
  fs.writeFileSync(parquetPath, Buffer.from(await res.arrayBuffer()));
  const relRows = (await parquetReadObjects({
    file: await asyncBufferFromFile(parquetPath),
  })) as Array<{ related_instance_id: string; experience_instance_id: string }>;
  const relatedIds = new Set(related.map(r => r.instance_id));
  const links = new Map<string, string[]>();
  for (const row of relRows) {
    if (!relatedIds.has(row.related_instance_id)) continue;
    const list = links.get(row.related_instance_id) ?? [];
    list.push(row.experience_instance_id);
    links.set(row.related_instance_id, list);
  }
  const relationship = [...links.entries()].map(([related_instance_id, experience_instance_ids]) => ({
    related_instance_id,
    experience_instance_ids,
  }));
  relationship.sort((a, b) => a.related_instance_id.localeCompare(b.related_instance_id));
  fs.writeFileSync(path.join(RAW_DIR, "relationship.json"), JSON.stringify(relationship, null, 1));
  console.log(`  ${relationship.length} related->experience links`);

  console.log("4/4 writing committed dataset...");
  const linkedExp = new Set(relationship.flatMap(l => l.experience_instance_ids));
  const expIds = new Set(experience.map(e => e.instance_id));
  const missing = [...linkedExp].filter(id => !expIds.has(id));
  if (missing.length > 0) {
    console.warn(`  WARN: ${missing.length} experience ids not found in trajectories: ${missing.slice(0, 5).join(", ")}`);
  }
  fs.writeFileSync(path.join(COMMIT_DIR, "related.json"), JSON.stringify(related));
  fs.writeFileSync(path.join(COMMIT_DIR, "experience.json"), JSON.stringify(experience));
  fs.writeFileSync(path.join(COMMIT_DIR, "relationship.json"), JSON.stringify(relationship));
  console.log(`  done -> ${COMMIT_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
