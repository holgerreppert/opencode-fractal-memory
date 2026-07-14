import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { load } from "js-yaml";
import type { MemoryStore } from "../../storage/sqlite";

const JOURNAL_DIR = path.join(os.homedir(), ".config", "opencode", "journal");

function splitFrontmatter(text: string): { frontmatterText: string | undefined; body: string } {
  if (!text.startsWith("---")) return { frontmatterText: undefined, body: text };
  const endIndex = text.indexOf("---", 3);
  if (endIndex === -1) return { frontmatterText: undefined, body: text };
  return { frontmatterText: text.slice(4, endIndex).trim(), body: text.slice(endIndex + 3).trim() };
}

export async function migrateJournalFiles(store: MemoryStore): Promise<{ imported: number; skipped: number; errors: { file: string; error: string }[] }> {
  const result = { imported: 0, skipped: 0, errors: [] as { file: string; error: string }[] };
  let files: string[];
  try {
    files = fs.readdirSync(JOURNAL_DIR).filter(f => f.endsWith(".md"));
  } catch {
    return result;
  }

  for (const file of files) {
    const filePath = path.join(JOURNAL_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const { frontmatterText, body } = splitFrontmatter(raw);
      if (!frontmatterText) {
        result.errors.push({ file, error: "Missing frontmatter" });
        continue;
      }
      const fm = load(frontmatterText) as Record<string, unknown> | undefined;
      if (!fm || !fm.title) {
        result.errors.push({ file, error: "Invalid frontmatter: missing title" });
        continue;
      }
      const id = path.basename(file, ".md");
      const label = `journal:${id}`;
      try {
        await store.getNodeByLabel("global", label);
        result.skipped++;
        continue;
      } catch {
        // not found — proceed
      }
      const tags = Array.isArray(fm.tags) ? (fm.tags as string[]).filter(t => typeof t === "string") : undefined;
      await store.createNode({
        scope: "global",
        label,
        content: body,
        type: "note",
        tags,
        metadata: {
          title: fm.title as string,
          project: (fm.project as string) ?? "",
          model: (fm.model as string) ?? "",
          provider: (fm.provider as string) ?? "",
          agent: (fm.agent as string) ?? "",
          sessionId: (fm.session_id as string) ?? "",
        },
        source: "manual",
      });
      result.imported++;
    } catch (err) {
      result.errors.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
