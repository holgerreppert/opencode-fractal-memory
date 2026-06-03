import type { MemoryNode } from "../../storage/sqlite";

export function formatPlaybooksAsAvailable(
  playbooks: Array<{ label: string; description: string; steps: number; executionCount: number }>
): string {
  if (playbooks.length === 0) return "";

  const entries = playbooks.map(pb =>
    `  <playbook>\n    <name>${pb.label}</name>\n    <description>${pb.description} (${pb.steps} steps, ${pb.executionCount} runs)</description>\n    <!-- memory_playbook_execute(playbook_id="${pb.label}") -->\n  </playbook>`
  ).join("\n");

  return `<available_playbooks>\n${entries}\n</available_playbooks>`;
}

export function formatSkillsAsAvailable(skills: MemoryNode[]): string {
  if (skills.length === 0) return "";

  const skillEntries = skills.map(skill => {
    const name = skill.label?.replace(/^skill:/, "") ?? skill.id.slice(0, 8);
    const description = skill.summary ?? skill.content.slice(0, 200);
    const triggers = skill.metadata?.triggers
      ? ` [triggers: ${Array.isArray(skill.metadata.triggers) ? skill.metadata.triggers.join(", ") : skill.metadata.triggers}]`
      : "";
    return `  <skill>\n    <name>${name}</name>\n    <description>${description}${triggers}</description>\n    <!-- memory_skill_load(name="${name}") -->\n  </skill>`;
  }).join("\n");

  return `<available_skills>\n${skillEntries}\n</available_skills>`;
}
