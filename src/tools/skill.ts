import { tool } from "@opencode-ai/plugin";
import type { MemoryScope, MemoryStore } from "../storage/sqlite";
import { wrapWithTracking } from "./shared";

export function MemorySkillLoad(store: MemoryStore) {
  const t = tool({
    description: "Load a skill's full instructions by name. Works for all skills (built-in and memory-stored). Call with the skill name to get the full markdown content.",
    args: {
      name: tool.schema.string(),
    },
    async execute(args) {
      const cleanName = (args.name ?? "").replace(/^skill:/, "").trim();
      if (!cleanName) {
        return "Error: skill name is required. Usage: memory_skill_load(name=\"skill-name\")";
      }

      for (const scope of ["global", "project"] as MemoryScope[]) {
        try {
          const node = await store.getNodeByLabel(scope, `skill:${cleanName}`);
          return `<skill_content name="${cleanName}">\n${node.content}\n</skill_content>`;
        } catch {
          // Not found in this scope
        }
      }

      const allNodes = await store.listNodes("all");
      const skills = allNodes.filter(n => n.type === "skill");
      const names = skills
        .map(s => s.label?.replace(/^skill:/, ""))
        .filter((n): n is string => !!n)
        .sort()
        .join(", ");

      if (names) {
        return `Skill '${cleanName}' not found. Available skills:\n\n${names}\n\n${skills.length} total skills. Use memory_skill_load(name="skill-name") to load one.`;
      }

      return `Skill '${cleanName}' not found. No skills available in memory database.`;
    },
  });
  return wrapWithTracking(t, store, "memory_skill_load");
}
