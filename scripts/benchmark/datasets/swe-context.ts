import * as fs from "node:fs";
import * as path from "node:path";

export type RelatedTask = {
  instance_id: string;
  repo: string;
  problem_statement: string;
  base_commit: string;
};

export type ExperienceTask = {
  instance_id: string;
  repo: string;
  summary: string;
  problem_statement: string;
  touched_files: string[];
  reasoning: string;
  tool_sequence: Array<{ name: string; target: string }>;
};

export type RelationshipLink = {
  related_instance_id: string;
  experience_instance_ids: string[];
};

const DATA_DIR = path.resolve(__dirname, "../../../tests/dbs/swe-contextbench");

export function loadRelatedTasks(dir: string = DATA_DIR): RelatedTask[] {
  return JSON.parse(fs.readFileSync(path.join(dir, "related.json"), "utf-8")) as RelatedTask[];
}

export function loadExperienceTasks(dir: string = DATA_DIR): ExperienceTask[] {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, "experience.json"), "utf-8")) as Array<
    Partial<ExperienceTask>
  >;
  return rows.map(r => ({
    instance_id: r.instance_id ?? "",
    repo: r.repo ?? "",
    summary: r.summary ?? "",
    problem_statement: r.problem_statement ?? "",
    touched_files: r.touched_files ?? [],
    reasoning: r.reasoning ?? "",
    tool_sequence: r.tool_sequence ?? [],
  }));
}

export function loadRelationshipLinks(dir: string = DATA_DIR): RelationshipLink[] {
  return JSON.parse(fs.readFileSync(path.join(dir, "relationship.json"), "utf-8")) as RelationshipLink[];
}

export function labelForExperience(instanceId: string): string {
  return `swe:${instanceId}`;
}
