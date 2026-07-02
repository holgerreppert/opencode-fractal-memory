import { describe, expect, test } from "bun:test";
import { distillRules } from "./auto-distill";
import type { MemoryStore } from "../storage/sqlite";

function makeMockStore(options: {
  lessons?: number;
  hasFixNodes?: boolean;
  existingContent?: string;
  hasMandatoryNode?: boolean;
}) {
  const nodes: Array<{
    id: string;
    label?: string;
    content: string;
    scope: string;
    createdAt: Date;
  }> = [];

  if (options.hasMandatoryNode !== false) {
    nodes.push({
      id: "rule-node",
      label: "rule:mandatory:memory",
      content: options.existingContent ?? "## Rules\n- search before get\n- replace needs re-read",
      scope: "global",
      createdAt: new Date(),
    });
  }

  for (let i = 0; i < (options.lessons ?? 0); i++) {
    nodes.push({
      id: `lesson-${i}`,
      label: `lesson:test-${i}`,
      content: `## Lesson ${i}\nWhat went wrong: thing ${i} failed`,
      scope: "global",
      createdAt: new Date(),
    });
  }

  if (options.hasFixNodes) {
    for (let i = 0; i < (options.lessons ?? 0); i++) {
      nodes.push({
        id: `lesson-${i}-fix`,
        label: `lesson:test-${i}:fix`,
        content: "- Check thing before starting\n- Verify node exists before memory_get",
        scope: "global",
        createdAt: new Date(),
      });
    }
  }

  const updateLog: Array<{ id: string; updates: Record<string, unknown> }> = [];

  const store = {
    listNodes: async () => nodes,
    getNodeByLabel: async (scope: string, label: string) => {
      const n = nodes.find(x => x.scope === scope && x.label === label);
      if (!n) throw new Error("not found");
      return n;
    },
    updateNode: async (id: string, updates: Record<string, unknown>) => {
      updateLog.push({ id, updates });
      const n = nodes.find(x => x.id === id);
      if (n && typeof updates.content === "string") {
        n.content = updates.content;
      }
    },
  };

  return { store: store as unknown as MemoryStore, updateLog, nodes };
}

describe("distillRules", () => {
  test("skips when lessons < minLessons", async () => {
    const { store } = makeMockStore({ lessons: 2 });
    const result = await distillRules(store, { minLessons: 5, useLlm: false });
    expect(result).toContain("skipped");
  });

  test("extracts fixes from lesson:xxx:fix nodes", async () => {
    const { store, nodes } = makeMockStore({ lessons: 3, hasFixNodes: true });
    await distillRules(store, { minLessons: 1, useLlm: false });
    const ruleNode = nodes.find(n => n.label === "rule:mandatory:memory");
    expect(ruleNode?.content).toContain("Always verify label exists before memory_get");
    expect(ruleNode?.content).toContain("Check thing before starting");
  });

  test("deduplicates identical fixes", async () => {
    const { store, } = makeMockStore({ lessons: 2, hasFixNodes: true });

    

    const result = await distillRules(store, { minLessons: 1, useLlm: false });
    expect(result).toContain("added");
  });

  test("skips rules already in rule:mandatory:memory", async () => {
    const { store } = makeMockStore({
      lessons: 1,
      hasFixNodes: true,
      existingContent: "## Rules\n- search before get\n- replace needs re-read first\n- Check thing before starting",
    });
    const result = await distillRules(store, { minLessons: 1, useLlm: false });
    expect(result).not.toContain("Check thing before starting");
  });

  test("appends to existing ### Auto-Learned section", async () => {
    const { store, nodes } = makeMockStore({
      lessons: 3,
      hasFixNodes: true,
      existingContent: "## Rules\n- search before get\n\n### Auto-Learned\n- Some old rule",
    });

    await distillRules(store, { minLessons: 1, useLlm: false });

    const ruleNode = nodes.find(n => n.label === "rule:mandatory:memory");
    expect(ruleNode?.content).toContain("### Auto-Learned");
    expect(ruleNode?.content).toContain("Some old rule");
    expect(ruleNode?.content).toContain("Always verify label exists before memory_get");
  });

  test("creates ### Auto-Learned section if absent", async () => {
    const { store, nodes } = makeMockStore({
      lessons: 3,
      hasFixNodes: true,
      existingContent: "## Rules\n- search before get",
    });

    await distillRules(store, { minLessons: 1, useLlm: false });

    const ruleNode = nodes.find(n => n.label === "rule:mandatory:memory");
    expect(ruleNode?.content).toContain("### Auto-Learned");
  });
});
