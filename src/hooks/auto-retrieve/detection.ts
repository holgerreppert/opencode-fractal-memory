import type { MemoryNode, MemoryStore } from "../../storage/sqlite";
import { scoreCandidates } from "./scoring";

type LogFn = (level: "debug" | "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;

export async function detectRelevantSkills(
  store: MemoryStore,
  query: string,
  queryEmbedding: number[],
  maxSkills: number = 3,
  log: LogFn
): Promise<MemoryNode[]> {
  try {
    const skillCandidates = await store.searchByEmbedding(
      queryEmbedding,
      maxSkills * 3,
      { bm25Weight: 0.3 }
    );

    const skills = skillCandidates.filter(n => n.type === "skill");

    if (skills.length === 0) {
      log("debug", "No skill nodes found");
      return [];
    }

    log("debug", "Found skill candidates", { count: skills.length });

    const scored = scoreCandidates(skills, query, queryEmbedding);

    const threshold = 0.15;
    const relevant = scored.filter(s => {
      const semantic = s.embedding && queryEmbedding.length > 0
        ? s.embedding.reduce((dot, v, i) => dot + v * (queryEmbedding[i] ?? 0), 0) /
          (Math.sqrt(s.embedding.reduce((s, v) => s + v * v, 0)) * Math.sqrt(queryEmbedding.reduce((s, v) => s + v * v, 0)) + 1e-8)
        : 0;
      return semantic > threshold;
    });

    const selected = relevant.slice(0, maxSkills);
    log("info", "Skill detection", { found: skills.length, selected: selected.length });

    return selected;
  } catch (err) {
    log("warn", "Skill detection failed", { error: String(err) });
    return [];
  }
}

export type PlaybookInfo = { label: string; description: string; steps: number; executionCount: number };

export async function detectRelevantPlaybooks(
  store: MemoryStore,
  queryEmbedding: number[],
  maxPlaybooks: number,
  log: LogFn
): Promise<PlaybookInfo[]> {
  try {
    const candidates = await store.searchByEmbedding(
      queryEmbedding,
      maxPlaybooks * 3,
      { bm25Weight: 0.4 }
    );

    const playbooks = candidates.filter(n => n.type === "playbook");
    if (playbooks.length === 0) {
      log("debug", "No matching playbooks found");
      return [];
    }
    const selected = playbooks.slice(0, maxPlaybooks);
    log("info", "Playbook detection", { found: playbooks.length, selected: selected.length });
    return selected.map(pb => ({
      label: pb.label || pb.id,
      description: pb.content?.slice(0, 200) || "",
      steps: (pb.metadata?.steps as Array<unknown>)?.length ?? 0,
      executionCount: (pb.metadata?.executionCount as number) ?? 0,
    }));
  } catch (err) {
    log("warn", "Playbook detection failed", { error: String(err) });
    return [];
  }
}
