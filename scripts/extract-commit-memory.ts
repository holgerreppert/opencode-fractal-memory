import * as path from "node:path";
import * as os from "node:os";
import { Database } from "bun:sqlite";
import { chat } from "../src/infrastructure/llm/ollama";

const DB_PATH = path.join(os.homedir(), ".config", "opencode", "memory.db");
const DRY_RUN = process.argv.includes("--dry-run");
const NO_LLM = process.argv.includes("--no-llm");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? Number(process.argv[limitIdx + 1] ?? 30) : 30;
const sinceIdx = process.argv.indexOf("--since");
const SINCE = sinceIdx !== -1 ? process.argv[sinceIdx + 1] : undefined;
const MAX_DIFF_CHARS = 6000;
const MAX_FILES_TAGGED = 8;

// Commit-intent extraction (MemCoder 2603.13258): mine git history into
// decision:<sha> memory nodes capturing WHY a change was made — the intent
// layer that commit messages alone rarely carry. LLM (Ollama) distills
// Why/Design/Validation from message+diff; without Ollama, falls back to the
// raw message so nodes still exist and dedup still works.

interface Commit {
  sha: string;
  subject: string;
  body: string;
}

function git(args: string): string {
  return Bun.spawnSync(["git", ...args.split(" ")], { stdout: "pipe" }).stdout.toString().trim();
}

function log(msg: string) {
  console.log(`[${DRY_RUN ? "DRY-RUN" : "EXTRACT"}] ${msg}`);
}

function listCommits(): Commit[] {
  const range = SINCE ? `${SINCE}..HEAD` : "HEAD";
  const field = "\u241E";
  const record = "\u241F";
  const out = git(`log -${LIMIT} --pretty=format:%H${field}%s${field}%b${record} ${range}`);
  if (!out) return [];
  return out
    .split(record)
    .map(entry => entry.replace(/^\n/, ""))
    .filter(Boolean)
    .map(entry => {
      const [sha = "", subject = "", ...bodyParts] = entry.split(field);
      const trimmedBody = bodyParts.join(field).trim();
      return { sha, subject, body: trimmedBody };
    });
}

function commitFiles(sha: string): string[] {
  const out = git(`show --name-only --pretty=format: ${sha}`);
  return out.split("\n").map(f => f.trim()).filter(Boolean);
}

function commitDiff(sha: string): string {
  const diff = git(`show --format= --unified=1 ${sha}`);
  return diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)" : diff;
}

async function distillIntent(commit: Commit, files: string[], diff: string): Promise<string | null> {
  try {
    const response = await chat([
      {
        role: "user",
        content: `A git commit changed these files:\n${files.slice(0, MAX_FILES_TAGGED).join("\n")}\n\nCommit message:\n${commit.subject}\n${commit.body}\n\nDiff (truncated):\n${diff}\n\nExplain this change for a future coding agent. Format EXACTLY as:\n## Why\n(1-2 sentences: problem or motivation)\n## Design\n(2-4 sentences: approach taken and why this one)\n## Validation\n(how to verify the change works)`,
      },
    ], { temperature: 0.3 });
    return response.includes("## Why") ? response.trim() : null;
  } catch {
    return null;
  }
}

async function main() {
  const commits = listCommits();
  log(`${commits.length} commits in range`);
  if (commits.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const db = new Database(DB_PATH);
  let created = 0;
  let skipped = 0;

  for (const commit of commits) {
    const label = `decision:${commit.sha}`;
    const existing = db.query("SELECT id FROM memory_nodes WHERE label = ? LIMIT 1").get(label);
    if (existing) {
      skipped++;
      continue;
    }

    const files = commitFiles(commit.sha);
    const fileTags = files.slice(0, MAX_FILES_TAGGED).map(f => `file:${f}`);
    const tags = ["decision", "auto_extract", "commit-memory", `commit:${commit.sha}`, ...fileTags];

    const contentLines = [
      `## Commit: ${commit.subject}`,
      "",
      `**SHA:** ${commit.sha}`,
      `**Files:** ${files.length}${files.length > MAX_FILES_TAGGED ? ` (first ${MAX_FILES_TAGGED} tagged)` : ""}`,
      "",
    ];
    if (commit.body) contentLines.push(`**Message body:**\n${commit.body}\n`);

    let content = contentLines.join("\n");
    let source = "auto_extract";

    if (!NO_LLM) {
      const diff = commitDiff(commit.sha);
      const intent = await distillIntent(commit, files, diff);
      if (intent) {
        content += `\n${intent}\n`;
        source = "reflection";
        log(`${label} — distilled via LLM`);
      } else {
        log(`${label} — LLM unavailable, storing raw message`);
      }
    }

    if (!DRY_RUN) {
      db.run(
        `INSERT INTO memory_nodes (id, scope, label, content, summary, level, parent_ids, embedding, embedding_blob, embedding_segments, created_at, updated_at, importance, access_count, last_accessed, type, category, supertype, domain, tags, source, metadata, sticky, ttl_days, expires_at, confidence, verification_count, usefulness_score, times_used, times_helpful, project_name, derived_from, derivation, status, valid_from, valid_until, supersedes_id, content_hash, subtask)
         VALUES (?, 'global', ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?, 0.7, 0, NULL, 'decision', 'semantic', 'declarative', 'architecture', ?, ?, ?, NULL, NULL, NULL, 0.5, 0, 0, 0, 0, NULL, NULL, NULL, 'active', ?, NULL, NULL, NULL, 'editing')`,
        [
          crypto.randomUUID(),
          label,
          content,
          commit.subject,
          Date.now(),
          Date.now(),
          JSON.stringify(tags),
          source,
          JSON.stringify({ sha: commit.sha, files: files.slice(0, 20), extractedBy: source === "reflection" ? "ollama" : "raw" }),
          Date.now(),
        ],
      );
    }
    created++;
  }

  db.close();
  log(`done: ${created} created, ${skipped} already present${DRY_RUN ? " (dry-run — nothing written)" : ""}`);
}

main();
