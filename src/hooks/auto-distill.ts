import type { MemoryStore } from "../storage/sqlite";
import { memLog } from "../logging";

export interface AutoDistillConfig {
  minLessons: number;
  useLlm: boolean;
}

export async function distillRules(
  store: MemoryStore,
  config: AutoDistillConfig,
  sessionId?: string,
  client?: unknown
): Promise<string> {
  const lessons = await store.listNodes("global");
  const lessonNodes = lessons.filter(n => n.label?.startsWith("lesson:") && !n.label.includes(":", 7));

  if (lessonNodes.length < config.minLessons) {
    return `Auto-distill: skipped, have ${lessonNodes.length} lessons, need ${config.minLessons}`;
  }

  const recentLessons = lessonNodes
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);

  const fixes: string[] = [];
  const allLessonNodes = lessons.filter(n => n.label?.startsWith("lesson:"));
  for (const lesson of recentLessons) {
    const fixNode = allLessonNodes.find(n => n.label === `${lesson.label}:fix`);
    if (fixNode?.content) {
      fixes.push(...fixNode.content.split("\n").filter(l => l.trim()));
    }
  }

  const uniqueFixes = [...new Set(fixes)];
  const distilledRules: string[] = [];

  for (const fix of uniqueFixes) {
    const match = fix.match(/^- (.+)$/);
    const action = match?.[1];
    if (action) {
      if (action.includes("memory_drilldown")) {
        distilledRules.push("- Avoid memory_drilldown with vague queries - use memory_search first");
      } else if (action.includes("memory_get")) {
        distilledRules.push("- Always verify label exists before memory_get");
      } else if (action.includes("memory_replace")) {
        distilledRules.push("- Re-read file before replace to ensure content is current");
      } else if (action.includes("read") || action.includes("glob")) {
        distilledRules.push("- Check if file exists before read/glob");
      } else if (action.includes("search before get")) {
        // Already in rules, skip
      } else {
        distilledRules.push(`- ${action}`);
      }
    }
  }

  if (config.useLlm && client && (client as any)?.session?.prompt) {
    try {
      const lessonContent = recentLessons.map(l => l.content).join("\n---\n");
      const prompt = `Based on these lesson summaries, generate specific, actionable rules for the agent.

Lessons:
${lessonContent}

Current rules:
${distilledRules.join("\n")}

Generate more specific rules based on the lessons. Focus on:
1. What specific checks to do before calling tools
2. What common mistakes to avoid
3. What order of operations works best

Format as bullet points starting with "- ".

Your rules:`;

      const result = await (client as { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } })
        .session?.prompt({
          path: { id: sessionId ?? "auto-distill" },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: prompt }],
          },
        });

      if (result) {
        const llmResponse = await (await result.text()).trim();
        if (llmResponse) {
          const llmRules = llmResponse.split("\n")
            .filter((line: string) => line.trim().startsWith("-"))
            .map((line: string) => line.trim());

          if (llmRules.length > 0) {
            distilledRules.push(...llmRules);
          }
        }
      }
    } catch (error) {
      memLog("error", "auto-distill", "LLM distillation failed:", { error });
    }
  }

  if (distilledRules.length === 0) {
    return `Auto-distill: no rules extracted from ${lessonNodes.length} lessons`;
  }

  const mandatoryNode = await store.getNodeByLabel("global", "rule:mandatory:memory").catch(() => null);
  if (!mandatoryNode) {
    return "Auto-distill: rule:mandatory:memory node not found";
  }

  const existingRules = mandatoryNode.content;
  const newRules: string[] = [];

  for (const rule of distilledRules) {
    const ruleText = rule.replace(/^- /, "");
    if (!existingRules.toLowerCase().includes(ruleText.toLowerCase().slice(0, 30))) {
      newRules.push(rule);
    }
  }

  if (newRules.length === 0) {
    return `Auto-distill: no new rules (${lessonNodes.length} lessons, all ${distilledRules.length} rules already exist)`;
  }

  const autoLearnedSection = "### Auto-Learned";
  const sectionIdx = existingRules.indexOf(autoLearnedSection);
  let updatedContent: string;

  if (sectionIdx >= 0) {
    const before = existingRules.slice(0, sectionIdx + autoLearnedSection.length);
    const after = existingRules.slice(sectionIdx + autoLearnedSection.length);
    updatedContent = before + "\n" + newRules.join("\n") + after;
  } else {
    updatedContent = existingRules + "\n\n" + autoLearnedSection + "\n" + newRules.join("\n");
  }

  await store.updateNode(mandatoryNode.id, { content: updatedContent });
  memLog("info", "auto-distill", `Added ${newRules.length} rules from ${lessonNodes.length} lessons`);
  return `Auto-distill: added ${newRules.length} new rules from ${lessonNodes.length} lessons`;
}
