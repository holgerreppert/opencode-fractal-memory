import type { MemoryStore } from "../storage/sqlite";
import { memLog } from "../logging";

export interface AutoCaptureConfig {
  enabled: boolean;
  minEdits: number;
  useLlm: boolean;
  maxPerSession: number;
}

export type CaptureSessionStats = Awaited<ReturnType<MemoryStore["getSessionStats"]>>;

const EDIT_TOOLS = new Set(["edit", "write", "replace", "apply_patch", "todoWrite", "todowrite", "todowrite-apply"]);

// Distilled completed-work nodes are the success-mirror of extractSessionLessons:
// lessons capture what went wrong, work-capture records what was built. A session
// that made real edits (files touched via edit/write) gets a compact knowledge
// node at session.idle so retrieval can surface "what did we do in that session"
// without depending on the agent remembering to store it manually.
export async function captureSessionWork(
  store: MemoryStore,
  config: AutoCaptureConfig,
  sessionId: string,
  client?: { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } } | undefined,
): Promise<string> {
  if (!config.enabled) return "Work: disabled";

  const stats = await store.getSessionStats(sessionId);
  if (!stats) return `Work: no session stats for ${sessionId}`;

  const edits = stats.toolCalls.filter(tc => tc.success === true && EDIT_TOOLS.has(tc.toolName));
  if (edits.length < config.minEdits) {
    return `Work: skipped, ${edits.length} successful edits < min ${config.minEdits}`;
  }

  const filesTouched = [...new Set(edits.map(e => e.filePath).filter((f): f is string => !!f))];
  const toolCounts = new Map<string, number>();
  for (const e of edits) toolCounts.set(e.toolName, (toolCounts.get(e.toolName) ?? 0) + 1);

  // Dedup: don't capture the same session's work repeatedly (or flood past a cap).
  const sessionTag = `sess:${sessionId}`;
  const existing = await store.listNodes("global", undefined, 100000);
  const capturedCount = existing.filter(n => (n.label ?? "").startsWith("work:") && n.tags?.includes(sessionTag)).length;
  if (capturedCount >= config.maxPerSession) {
    return `Work: skipped, session already has ${capturedCount} work node(s) (cap ${config.maxPerSession})`;
  }

  const timestamp = Date.now();
  const label = `work:${timestamp}`;

  const lines: string[] = [`## Completed Work: ${sessionId}`, ""];
  lines.push(`**Status:** ${stats.status}`);
  lines.push(`**Edits made:** ${edits.length}`);
  lines.push(`**Files touched:** ${filesTouched.length}`);
  lines.push("");
  if (filesTouched.length > 0) {
    lines.push("### Files Modified");
    for (const f of filesTouched) lines.push(`- ${f}`);
    lines.push("");
  }
  lines.push("### Tools Used");
  for (const [tool, count] of toolCounts) lines.push(`- ${tool}: ${count} call(s)`);
  lines.push("");

  let content = lines.join("\n");

  if (config.useLlm && client?.session?.prompt) {
    try {
      const filesList = filesTouched.join(", ");
      const toolsList = [...toolCounts].map(([t, c]) => `${t} (${c}x)`).join(", ");
      const prompt = `A coding-agent session completed work and made ${edits.length} edits. Summarize what was likely accomplished so a future agent can resume or reference it.

Session: ${sessionId}
Files modified: ${filesList || "none"}
Tools: ${toolsList}

Produce a concise "What was done" summary (2-4 sentences) describing the most plausible work from the file names and tool usage. Focus on the changes' purpose, not mechanics.`;

      const result = await client.session.prompt({
        path: { id: sessionId },
        body: {
          noReply: true,
          parts: [{ type: "text", text: prompt }],
        },
      });
      const response = await (await result.text()).trim();
      if (response) {
        content += `\n### What Was Done (LLM)\n${response}\n`;
      }
    } catch (error) {
      memLog("error", "work", "LLM work summary failed:", { error });
    }
  }

  await store.createNode({
    scope: "global",
    label,
    content,
    level: 0,
    importance: 0.7,
    type: "knowledge",
    parentIds: null,
    source: "auto_extract",
    tags: ["knowledge", "work", "auto_extract", sessionTag],
    metadata: {
      sessionId,
      editCount: edits.length,
      filesTouched: filesTouched.length,
      files: filesTouched.slice(0, 20),
      toolCounts: Object.fromEntries(toolCounts),
    },
  });

  memLog("info", "work", `Captured work node ${label} (${edits.length} edits, ${filesTouched.length} files)`);
  return `Work: created ${label} with ${edits.length} edits across ${filesTouched.length} files`;
}
