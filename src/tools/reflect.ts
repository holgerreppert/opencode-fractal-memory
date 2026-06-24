import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { wrapWithTracking } from "./shared";
import { memLog } from "../logging";

export function MemoryReflect(store: MemoryStore, client?: unknown) {
  const t = tool({
    description: "Analyze a session to create lesson nodes from failures. Creates structured lessons with analysis, root cause, and actionable fix. Call this after session ends to learn from mistakes.",
    args: {
      session_id: tool.schema.string().optional().describe("Session ID to analyze. If not provided, prompts for it."),
      dry_run: tool.schema.boolean().optional().default(false).describe("If true, outputs analysis without creating nodes for verification"),
      use_llm: tool.schema.boolean().optional().default(false).describe("If true, uses LLM to generate more specific analysis and fixes"),
    },
    async execute(args, toolCtx) {
      const sessionId = args.session_id ?? toolCtx.sessionID;
      
      if (!sessionId) {
        return "No session_id provided. Please provide a session ID to analyze.";
      }

      const stats = await store.getSessionStats(sessionId);
      if (!stats) {
        return `No data found for session: ${sessionId}`;
      }

      const failedCalls = stats.toolCalls.filter(tc => tc.success === false);
      
      if (failedCalls.length === 0) {
        return `## Session Reflection: ${sessionId}\n\nNo failed tools to analyze. Session completed successfully with ${stats.totalToolCalls} tool calls.`;
      }

      const dryRun = args.dry_run ?? false;

      const analysisLines = [`## Session Reflection: ${sessionId}`, ""];
      analysisLines.push(`**Status:** ${stats.status}`);
      analysisLines.push(`**Total calls:** ${stats.totalToolCalls}`);
      analysisLines.push(`**Failed:** ${failedCalls.length}`);
      analysisLines.push("");

      const toolFailureCounts = new Map<string, number>();
      const fileFailures = new Map<string, string[]>();
      
      for (const fc of failedCalls) {
        const tool = fc.toolName;
        toolFailureCounts.set(tool, (toolFailureCounts.get(tool) ?? 0) + 1);
        
        if (fc.filePath) {
          const existing = fileFailures.get(fc.filePath) ?? [];
          existing.push(tool);
          fileFailures.set(fc.filePath, existing);
        }
      }

      analysisLines.push("### Failed Tools");
      for (const [tool, count] of toolFailureCounts) {
        analysisLines.push(`- ${tool}: ${count} failure(s)`);
      }
      analysisLines.push("");

      if (fileFailures.size > 0) {
        analysisLines.push("### Files with Failures");
        for (const [file, tools] of fileFailures) {
          analysisLines.push(`- ${file}: ${tools.join(", ")}`);
        }
        analysisLines.push("");
      }

      analysisLines.push("### Analysis");
      
      const lessons: string[] = [];
      const patterns: Record<string, (count: number, tool: string) => string> = {
        memory_drilldown: (count) => `Avoid memory_drilldown with vague queries - use memory_search first (failed ${count}x)`,
        memory_get: (count) => `Verify label exists before memory_get - search first if unsure (failed ${count}x)`,
        memory_replace: (count) => `Re-read file before memory_replace to ensure content is current (failed ${count}x)`,
        memory_delete: (count) => `Verify node exists before memory_delete (failed ${count}x)`,
        edit: (count) => `Read file before edit, ensure oldText matches exactly (failed ${count}x)`,
        write: (count) => `Check if file exists before write - prefer edit for existing files (failed ${count}x)`,
        read: (count) => `Check file exists before read - use glob to find files (failed ${count}x)`,
        glob: (count) => `Use more specific glob patterns (failed ${count}x)`,
        grep: (count) => `Check file path exists before grep (failed ${count}x)`,
        bash: (count) => `Verify command exists and paths are correct (failed ${count}x)`,
        search: (count) => `Check search parameters (failed ${count}x)`,
      };
      
      const defaultPattern = (count: number, tool: string) => 
        tool.startsWith("memory_") 
          ? `Review ${tool} usage - verify inputs before calling (failed ${count}x)`
          : `Check ${tool} arguments and prerequisites (failed ${count}x)`;
      
      for (const [tool, count] of toolFailureCounts) {
        const generator = patterns[tool] || defaultPattern;
        lessons.push(`- ${generator(count, tool)}`);
      }

      if (lessons.length === 0) {
        lessons.push("- Review tool arguments and ensure correct format");
      }

      for (const lesson of lessons) {
        analysisLines.push(lesson);
      }

      const timestamp = Date.now();
      const label = `lesson:${timestamp}`;
      let content = analysisLines.join("\n");

      if (args.use_llm && client && (client as { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } }).session?.prompt) {
        try {
          const prompt = `Analyze these tool failures and provide specific, actionable fixes:

Session: ${sessionId}
Failed tools: ${[...toolFailureCounts].map(([t, c]) => `${t} (${c}x)`).join(", ")}
Files affected: ${[...fileFailures].map(([f, tools]) => `${f} (${tools.join(", ")})`).join(", ")}

For each failure type, provide a specific, concrete rule that would prevent the failure.
Format as a bullet list starting with "- ". Be specific about what to check/verify.

Example good rules:
- Before memory_drilldown, first run memory_search with keywords to verify the label exists
- Before edit, read the file and ensure oldText exactly matches what's in the file (no extra whitespace)
- Check file exists with glob before using read or edit on it

Your rules:`;

          const result = await (client as { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } })
            .session?.prompt({
              path: { id: toolCtx.sessionID },
              body: { 
                noReply: true, 
                parts: [{ type: 'text', text: prompt }] 
              },
            });

          if (result) {
            const llmResponse = await (await result.text()).trim();
            if (llmResponse) {
              const llmRules = llmResponse.split("\n")
                .filter((line: string) => line.trim().startsWith("-"))
                .map((line: string) => line.trim());
              
              if (llmRules.length > 0) {
                lessons.push(...llmRules);
                content += `\n\n### LLM-Generated Analysis\n${llmResponse}`;
              }
            }
          }
        } catch (error) {
          memLog("error", "reflect", "LLM analysis failed:", { error });
        }
      }

      if (dryRun) {
        return `## Dry Run: Lesson Preview\n\n**Would create:** ${label}\n\n${content}\n\n---\n\n**Suggested fixes:**\n${lessons.join("\n")}\n\n---\n\nTo save these lessons, run without dry_run: true`;
      }

      await store.createNode({
        scope: "global",
        label,
        content,
        level: 0,
        importance: 0.8,
        type: "note",
        parentIds: null,
      });

      const analysisNodeLabel = `${label}:analysis`;
      await store.createNode({
        scope: "global",
        label: analysisNodeLabel,
        content: analysisLines.slice(0, 15).join("\n"),
        level: 0,
        importance: 0.6,
        type: "note",
        parentIds: [label],
      });

      const fixNodeLabel = `${label}:fix`;
      const fixContent = lessons.map(l => l.replace(/^- /, "- ")).join("\n");
      await store.createNode({
        scope: "global",
        label: fixNodeLabel,
        content: fixContent,
        level: 0,
        importance: 0.7,
        type: "note",
        parentIds: [label],
      });

      return `## Reflection Complete\n\nCreated lesson node: ${label}\n\n**Summary:** ${failedCalls.length} failures from ${stats.totalToolCalls} calls\n\n**Key lessons:**\n${lessons.join("\n")}\n\nReview and verify these lessons. Then use memory_distill to extract rules.`;
    },
  });
  return wrapWithTracking(t, store, "memory_reflect");
}

export function MemoryDistill(store: MemoryStore, client?: unknown) {
  const t = tool({
    description: "Extract actionable rules from recent lesson nodes and update rule:mandatory nodes. Call this after reviewing lessons from memory_reflect.",
    args: {
      dry_run: tool.schema.boolean().optional().describe("Show what would change without applying (default: false)").default(false),
      use_llm: tool.schema.boolean().optional().describe("Use LLM to generate more specific rules from lessons").default(false),
    },
    async execute(args, toolCtx) {
      const lessons = await store.listNodes("global");
      const lessonNodes = lessons.filter(n => n.label?.startsWith("lesson:") && !n.label.includes(":", 7));
      
      if (lessonNodes.length === 0) {
        return "No lesson nodes found. Run memory_reflect first to create lessons.";
      }

      const recentLessons = lessonNodes
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 10);

      const fixes: string[] = [];
      const allLessons = lessons.filter(n => n.label?.startsWith("lesson:"));
      for (const lesson of recentLessons) {
        const fixNode = allLessons.find(n => n.label === `${lesson.label}:fix`);
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

      if (args.use_llm && client && (client as { session?: { prompt: string } })?.session?.prompt) {
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
              path: { id: toolCtx.sessionID },
              body: { 
                noReply: true, 
                parts: [{ type: 'text', text: prompt }] 
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
          memLog("error", "reflect", "LLM distillation failed:", { error });
        }
      }

      const output = ["## Rule Distillation Results", ""];
      output.push(`Analyzed ${recentLessons.length} recent lessons`);
      output.push(`Extracted ${distilledRules.length} potential rules`);
      output.push("");

      if (args.dry_run) {
        output.push("### Proposed Changes (Dry Run)");
        output.push("");
        output.push("To apply these rules, run: memory_distill (without dry_run)");
        output.push("To discard, just ignore this output.");
      } else {
        output.push("### Updated Rules");
      }

      const mandatoryNode = await store.getNodeByLabel("global", "rule:mandatory:memory").catch(() => null);
      const existingRules = mandatoryNode?.content ?? "";

      for (const rule of distilledRules) {
        const ruleText = rule.replace(/^- /, "");
        if (!existingRules.toLowerCase().includes(ruleText.toLowerCase().slice(0, 30))) {
          output.push(rule);
        }
      }

      if (!args.dry_run && output.length > 4) {
        const currentContent = mandatoryNode?.content ?? "## Memory Tool Mandatory Rules\ntag: rule:mandatory\n\n";
        const newContent = currentContent + "\n" + distilledRules.map(r => `### Auto-Learned\n${r}`).join("\n");
        
        if (mandatoryNode) {
          await store.updateNode(mandatoryNode.id, { content: newContent });
          output.push("\n**Updated rule:mandatory:memory**");
        }
      }

      return output.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_distill");
}