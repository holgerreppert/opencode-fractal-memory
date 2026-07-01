import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { wrapWithContextWarning, wrapWithTracking } from "./shared";

export function MemoryPlaybookExecute(memoryStore: MemoryStore) {
  const t = tool({
    description: "Execute a playbook — returns the ordered steps for the agent to follow. The agent should execute each step in sequence and report progress.",
    args: {
      playbook_id: tool.schema.string().describe("The playbook label (e.g. 'playbook:debug-workflow')"),
      params: tool.schema.string().optional().describe("JSON object of parameter values to substitute into step params"),
    },
    async execute(args) {
      let node;
      try {
        node = await memoryStore.getNodeByLabel("project", args.playbook_id);
      } catch {
        return `Playbook not found: ${args.playbook_id}. List available playbooks with memory_search({ type: "playbook" }).`;
      }

      const metadata = node.metadata || {};
      const rawSteps = metadata.steps;
      const steps: Array<{ toolName: string; description: string; params: Record<string, string>; expectedOutcome?: string; critical: boolean }> = Array.isArray(rawSteps) ? rawSteps as Array<Record<string, unknown>> as Array<{ toolName: string; description: string; params: Record<string, string>; expectedOutcome?: string; critical: boolean }> : [];
      if (steps.length === 0) {
        return `Playbook "${args.playbook_id}" has no steps defined in its metadata.`;
      }

      let params: Record<string, string> = {};
      if (args.params) {
        try {
          params = JSON.parse(args.params);
          if (typeof params !== "object" || Array.isArray(params)) throw new Error();
        } catch {
          return "Error: params must be a valid JSON object.";
        }
      }

      const resolvedSteps = steps.map((step, i) => {
        const resolvedParams: Record<string, string> = {};
        for (const [key, val] of Object.entries(step.params)) {
          resolvedParams[key] = val.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
        }
        return {
          index: i + 1,
          toolName: step.toolName,
          description: step.description,
          params: resolvedParams,
          expectedOutcome: step.expectedOutcome,
          critical: step.critical,
        };
      });

      const executionCount = ((metadata.executionCount as number) ?? 0) + 1;
      await memoryStore.updateNode(node.id, {
        metadata: { ...metadata, executionCount, lastExecutedAt: Date.now() },
      });

      const stepsStr = resolvedSteps.map(s =>
        `Step ${s.index}: ${s.toolName} — ${s.description}\n` +
        `  Params: ${JSON.stringify(s.params)}${s.expectedOutcome ? `\n  Expected: ${s.expectedOutcome}` : ""}${s.critical ? " critical" : ""}`
      ).join("\n\n");

      const label = node.label || args.playbook_id;
      return wrapWithContextWarning(
        `Executing playbook: ${label}\n` +
        `Description: ${node.content?.slice(0, 200) || "No description"}\n` +
        `Total steps: ${steps.length}\n\n` +
        `${stepsStr}\n\n` +
        `Execute each step above in order. Report completion after each step.`
      );
    },
  });
  return wrapWithTracking(t, memoryStore, "memory_playbook_execute");
}
