import type { MemoryStore } from "../storage/sqlite";
import { memLog } from "../logging";
import { inferSubtask } from "./subtask";

export interface AutoLessonsConfig {
  enabled: boolean;
  minFailures: number;
  useLlm: boolean;
}

export type SessionStats = Awaited<ReturnType<MemoryStore["getSessionStats"]>>;

// Distilled lessons are the highest-value content a coding agent can retain
// (ArcticMem Tier-2, Metis, LME-V2): they capture what went wrong, why, and
// how to avoid it next time. This runs at session.idle and extracts a compact
// lesson node from the session's failed tool calls, then dedups against prior
// lessons (a session whose failures are already covered creates nothing).
export async function extractSessionLessons(
  store: MemoryStore,
  config: AutoLessonsConfig,
  sessionId: string,
  client?: { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } } | undefined,
): Promise<string> {
  if (!config.enabled) return "Lessons: disabled";

  const stats = await store.getSessionStats(sessionId);
  if (!stats) return `Lessons: no session stats for ${sessionId}`;

  const failedCalls = stats.toolCalls.filter(tc => tc.success === false);
  if (failedCalls.length < config.minFailures) {
    return `Lessons: skipped, ${failedCalls.length} failures < min ${config.minFailures}`;
  }

  const toolFailureCounts = new Map<string, number>();
  const fileFailures = new Map<string, string[]>();
  for (const fc of failedCalls) {
    toolFailureCounts.set(fc.toolName, (toolFailureCounts.get(fc.toolName) ?? 0) + 1);
    if (fc.filePath) {
      const existing = fileFailures.get(fc.filePath) ?? [];
      existing.push(fc.toolName);
      fileFailures.set(fc.filePath, existing);
    }
  }

  // Signature of this session's failures — used for ArcticMem-style dedup.
  const signature = [...toolFailureCounts.keys()].sort().join(",");
  if (signature.length === 0) return "Lessons: skipped, no failure signature";

  const lessons = await store.listNodes("global", undefined, 100000);
  const covered = lessons.some(n =>
    (n.label ?? "").startsWith("lesson:")
    && n.tags?.includes(`sig:${signature}`)
  );
  if (covered) {
    return `Lessons: skipped, failure signature already covered (${signature})`;
  }

  const timestamp = Date.now();
  const label = `lesson:${timestamp}`;

  const lines: string[] = [`## Session Lesson: ${sessionId}`, ""];
  lines.push(`**Status:** ${stats.status}`);
  lines.push(`**Total calls:** ${stats.totalToolCalls}`);
  lines.push(`**Failed:** ${failedCalls.length}`);
  lines.push("");
  lines.push("### Failed Tools");
  for (const [tool, count] of toolFailureCounts) {
    lines.push(`- ${tool}: ${count} failure(s)`);
  }
  lines.push("");
  if (fileFailures.size > 0) {
    lines.push("### Files with Failures");
    for (const [file, tools] of fileFailures) {
      lines.push(`- ${file}: ${tools.join(", ")}`);
    }
    lines.push("");
  }

  let content = lines.join("\n");

  if (config.useLlm && client?.session?.prompt) {
    try {
      const failedList = [...toolFailureCounts].map(([t, c]) => `${t} (${c}x)`).join(", ");
      const prompt = `Analyze these tool failures from a coding-agent session and provide specific, actionable lessons:

Session: ${sessionId}
Failed tools: ${failedList}
Files affected: ${[...fileFailures].map(([f, t]) => `${f} (${t.join(", ")})`).join(", ")}

For each failure type, provide a specific, concrete rule that would prevent the failure.
Format as a bullet list starting with "- ". Be specific about what to check/verify.

Example good lessons:
- Before memory(mode="drilldown"), first run memory(mode="search") with keywords to verify the label exists
- Before edit, read the file and ensure oldText exactly matches what's in the file (no extra whitespace)
- Check file exists with glob before using read or edit on it

Your lessons:`;

      const result = await client.session.prompt({
        path: { id: sessionId },
        body: {
          noReply: true,
          parts: [{ type: "text", text: prompt }],
        },
      });
      const response = await (await result.text()).trim();
      if (response) {
        const rules = response.split("\n").filter((line: string) => line.trim().startsWith("-"));
        if (rules.length > 0) {
          content += `\n\n### LLM-Generated Lessons\n${rules.join("\n")}`;
        }
      }
    } catch (error) {
      memLog("error", "lessons", "LLM lesson generation failed:", { error });
    }
  }

  await store.createNode({
    scope: "global",
    label,
    content,
    level: 0,
    importance: 0.8,
    type: "lesson",
    parentIds: null,
    source: "auto_extract",
    subtask: inferSubtask(failedCalls),
    tags: ["lesson", "auto_extract", `sig:${signature}`],
    metadata: {
      sessionId,
      failedCount: failedCalls.length,
      totalCalls: stats.totalToolCalls,
      failedTools: [...toolFailureCounts.keys()],
    },
  });

  memLog("info", "lessons", `Extracted lesson ${label} (${failedCalls.length} failures)`);
  return `Lessons: created ${label} with ${failedCalls.length} failure patterns`;
}
