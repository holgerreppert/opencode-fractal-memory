import { describe, expect, test, beforeEach } from "bun:test";
import { createContextCompressTransformHandler } from "./context-compress-transform";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { getCompressState, recordCompressBlock, clearCompressState, forgetCompressSession, rebuildCompressState } from "../../application/context-compression/state";

function makeConfig(): MemConfig {
  return {
    contextCompression: { enabled: true, permission: "compress", maxHistoryNodesPerSession: 30, historyTtlDays: 30, nudgePressureThreshold: 0.6 },
    injectionVisibility: { enabled: true, markers: true, digest: true },
  } as unknown as MemConfig;
}

function makeStore(): MemoryStore {
  return {
    getNodeByLabel: async () => { throw new Error("not found"); },
  } as unknown as MemoryStore;
}

// Store stub that holds a registry node whose content can be read/updated.
function makeRegistryStore(initialEntries: unknown[]): MemoryStore & { registryContent: () => string } {
  let content = JSON.stringify({ entries: initialEntries });
  const node = { id: "reg-1", label: "contexthistory:index:ses-test", content };
  return {
    getNodeByLabel: async () => {
      node.content = content;
      return node;
    },
    updateNode: async (_id: string, patch: { content?: string }) => {
      if (typeof patch.content === "string") content = patch.content;
    },
    registryContent: () => content,
  } as unknown as MemoryStore & { registryContent: () => string };
}

function makeMessage(id: string, role: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    info: { id, role, ...extra },
    parts: [{ type: "text", text }],
  };
}

const SESSION = "ses-test";

// Messages carrying the always-on proprioception dashboard (injected after the
// last user message) — filter them out so index-based assertions stay stable.
function withoutDashboard(msgs: Array<{ info: { id?: string }; parts: Array<{ text?: string }> }>) {
  return msgs.filter(m => !(m.parts[0]?.text ?? "").startsWith("[memory-plugin:context-compress] context "));
}

beforeEach(() => {
  forgetCompressSession(SESSION);
});

describe("createContextCompressTransformHandler", () => {
  test("returns empty handler when contextCompression disabled", () => {
    const config = { contextCompression: { enabled: false } } as unknown as MemConfig;
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    expect(Object.keys(handler)).toHaveLength(0);
  });

  test("injects [message <id>] markers on user/assistant messages", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const output = { messages: [
      makeMessage("msg-1", "user", "Hello there"),
      makeMessage("msg-2", "assistant", "Hi!"),
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const msgs = output.messages as Array<{ info: { id?: string }; parts: Array<{ text?: string }> }>;
    const real = withoutDashboard(msgs);
    expect(real).toHaveLength(3);
    expect(real[0]!.parts[0]!.text).toContain("[message msg-1]");
    expect(real[1]!.parts[0]!.text).toContain("[message msg-2]");
    expect(real[2]!.parts[0]!.text).toContain("[message msg-3]");
  });

  test("replaces compressed messages with synthetic placeholder", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    recordCompressBlock(SESSION, "msg-2", {
      blockId: "m0001",
      nodeId: "node-x",
      label: "contexthistory:ses-test:0",
      summary: "assistant explained the fix",
      topic: "fixing graph hook",
    });
    const output = { messages: [
      makeMessage("msg-1", "user", "Please fix it"),
      makeMessage("msg-2", "assistant", "Here is a very long explanation of the bug and the fix that should be archived"),
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const msgs = output.messages as Array<{ info: { id?: string }; parts: Array<{ text?: string }> }>;
    const real = withoutDashboard(msgs);
    expect(real).toHaveLength(3);
    expect(real[1]!.parts[0]!.text).toContain("[Compressed conversation section]");
    expect(real[1]!.parts[0]!.text).toContain("fixing graph hook");
    expect(real[1]!.parts[0]!.text).toContain("contexthistory:ses-test:0");
    expect(real[1]!.parts[0]!.text).not.toContain("very long explanation");
  });

  test("does not double-mark already-compressed messages", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    recordCompressBlock(SESSION, "msg-1", {
      blockId: "m0001",
      nodeId: "node-x",
      label: "contexthistory:ses-test:0",
      summary: "summary here",
      topic: "topic",
    });
    const output = { messages: [
      makeMessage("msg-1", "user", "original user text that was compressed"),
      makeMessage("msg-2", "assistant", "reply"),
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const msgs = output.messages as Array<{ parts: Array<{ text?: string }> }>;
    const real = withoutDashboard(msgs as Array<{ info: { id?: string }; parts: Array<{ text?: string }> }>);
    // msg-1 replaced by synthetic (no marker added), msg-2 gets marker
    expect(real[0]!.parts[0]!.text).toContain("[Compressed conversation section]");
    expect(real[1]!.parts[0]!.text).toContain("[message msg-2]");
  });

  test("clears compress state on compaction message", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    recordCompressBlock(SESSION, "msg-2", {
      blockId: "m0001",
      nodeId: "node-x",
      label: "contexthistory:ses-test:0",
      summary: "s",
      topic: "t",
    });
    expect(getCompressState(SESSION).blocks.size).toBe(1);
    const output = { messages: [
      makeMessage("msg-1", "user", "hi"),
      makeMessage("msg-2", "assistant", "bye"),
      { info: { type: "compaction", id: "cmp-1" }, parts: [] },
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    expect(getCompressState(SESSION).blocks.size).toBe(0);
    // After clearing, msg-2 is NOT compressed anymore
    const msgs = output.messages as Array<{ info: { id?: string }; parts: Array<{ text?: string }> }>;
    const real = withoutDashboard(msgs);
    expect(real[1]!.parts[0]!.text).toContain("[message msg-2]");
  });

  test("detects compaction via PART type (real opencode shape)", async () => {
    // opencode stores compaction as {"type":"compaction","tail_start_id":...} in
    // msg.parts, NOT info.type — info spreads row.data which has no `type` field.
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    recordCompressBlock(SESSION, "msg-2", {
      blockId: "m0001",
      nodeId: "node-x",
      label: "contexthistory:ses-test:0",
      summary: "s",
      topic: "t",
    });
    expect(getCompressState(SESSION).blocks.size).toBe(1);
    const output = { messages: [
      makeMessage("msg-1", "user", "hi"),
      makeMessage("msg-2", "assistant", "bye"),
      { info: { role: "user", id: "cmp-1" }, parts: [{ type: "compaction", tail_start_id: "msg-old" }] },
    ] };
    await handler["chat.messages.transform"]!({}, output);
    expect(getCompressState(SESSION).blocks.size).toBe(0);
  });

  test("adds nudge line when messages exceed token thresholds", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const bigText = "word ".repeat(2000); // ~4000+ tokens
    const output = { messages: [
      makeMessage("msg-1", "user", "small"),
      makeMessage("msg-2", "user", bigText),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("compress");
    expect(joined).toContain("[message msg-2]");
  });

  test("nudge counts TOOL part outputs (the context hogs text-only missed)", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    // A message whose ONLY large payload is a tool output — invisible to the
    // old text-only sizing, must be flagged now.
    const bigOutput = "output-line ".repeat(2000); // ~4000+ tokens
    const output = { messages: [
      makeMessage("msg-1", "user", "run the command"),
      {
        info: { id: "msg-2", role: "assistant" },
        parts: [{ type: "tool", tool: "bash", state: { status: "completed", output: bigOutput, input: { command: "ls" } } }],
      },
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("[message msg-2]");
    expect(joined).toContain("est");
  });

  test("nudge prefers REAL token counts when info.tokens present", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    // Short text but real provider-reported 9000 output tokens → HIGH priority.
    const output = { messages: [
      makeMessage("msg-1", "user", "hi"),
      {
        info: { id: "msg-2", role: "assistant", tokens: { input: 100, output: 9000, reasoning: 0, cache: { read: 0, write: 0 } } },
        parts: [{ type: "text", text: "short" }],
      },
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("[message msg-2]");
    expect(joined).toContain("real");
  });

  test("nudge counts reasoning part text", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const bigReasoning = "thinking ".repeat(2000); // ~4000+ tokens
    const output = { messages: [
      makeMessage("msg-1", "user", "solve it"),
      {
        info: { id: "msg-2", role: "assistant" },
        parts: [{ type: "reasoning", text: bigReasoning }, { type: "text", text: "done" }],
      },
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("[message msg-2]");
  });

  test("mutates the messages array IN PLACE (core keeps original reference)", async () => {
    // OpenCode core (packages/opencode/src/session/prompt.ts) passes
    // { messages: msgs } to the trigger and continues using the original
    // `msgs` variable — a reassigned output.messages is silently discarded.
    // The transform MUST mutate the array object itself.
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    recordCompressBlock(SESSION, "msg-2", {
      blockId: "m0001",
      nodeId: "node-x",
      label: "contexthistory:ses-test:0",
      summary: "assistant explained the fix",
      topic: "fixing graph hook",
    });
    const messages = [
      makeMessage("msg-1", "user", "Please fix it"),
      makeMessage("msg-2", "assistant", "Here is a very long explanation that should be pruned"),
      makeMessage("msg-3", "user", "continue"),
    ];
    const output = { messages };
    const originalArray = output.messages;
    await handler["chat.messages.transform"]!({}, output);
    // The SAME array object must be mutated (identity preserved)
    expect(output.messages).toBe(originalArray);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text);
    expect(texts[1]).toContain("[Compressed conversation section]");
  });

  test("no-op path keeps array identity AND content", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const messages = [
      makeMessage("msg-1", "user", "Hello there"),
      makeMessage("msg-2", "assistant", "Hi!"),
      makeMessage("msg-3", "user", "continue"),
    ];
    const output = { messages };
    const originalArray = output.messages;
    await handler["chat.messages.transform"]!({}, output);
    expect(output.messages).toBe(originalArray);
    // Always-on dashboard inserted after the last user message (index 2).
    expect(output.messages).toHaveLength(4);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text);
    expect(texts[0]).toContain("[message msg-1]");
    expect(texts[2]).toContain("[message msg-3]");
    expect(texts[3]).toContain("[memory-plugin:context-compress] context ");
  });

  test("mid-turn tool-loop request passes through untouched (no prune, no nudge)", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    recordCompressBlock(SESSION, "msg-2", {
      blockId: "m0001",
      nodeId: "node-x",
      label: "contexthistory:ses-test:0",
      summary: "assistant explained the fix",
      topic: "fixing graph hook",
    });
    const bigText = "word ".repeat(2000);
    const messages = [
      makeMessage("msg-1", "user", "Please fix it"),
      makeMessage("msg-2", "assistant", "Here is a very long explanation that should be pruned"),
      makeMessage("msg-3", "user", "run the command"),
      {
        info: { id: "msg-4", role: "assistant" },
        parts: [{ type: "tool", tool: "bash", state: { status: "completed", output: bigText, input: { command: "ls" } } }],
      },
    ];
    const output = { messages };
    const originalArray = output.messages;
    await handler["chat.messages.transform"]!({}, output);
    // Mid-turn (last message is assistant tool result): array identity AND
    // content must be preserved — no pruning, no markers, no nudge injection.
    expect(output.messages).toBe(originalArray);
    expect(output.messages).toHaveLength(4);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    expect(texts[0]).not.toContain("[message msg-1]");
    expect(texts[1]).not.toContain("[Compressed conversation section]");
    expect(texts.join("\n")).not.toContain("[memory-plugin:context-compress] context ");
  });

  test("nudge is deduped per turn", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const bigText = "word ".repeat(2000);
    const output1 = { messages: [makeMessage("msg-1", "user", bigText)] };
    await handler["chat.messages.transform"]!({}, output1);
    const output2 = { messages: [makeMessage("msg-1", "user", bigText)] };
    await handler["chat.messages.transform"]!({}, output2);
    const texts2 = (output2.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    expect(texts2.join("\n")).not.toContain("compress");
  });

  test("marks registry entries outside the view as compacted on compaction", async () => {
    // Registry holds entries for msg-dead (pre-tail, invisible) and msg-live (in view).
    const store = makeRegistryStore([
      { ref: "m0001", msgId: "msg-dead", status: "archived", summary: "s1", label: "contexthistory:ses-test:0", topic: "old" },
      { ref: "m0002", msgId: "msg-live", status: "archived", summary: "s2", label: "contexthistory:ses-test:0", topic: "new" },
    ]);
    // Prime in-memory blocks so both entries are tracked before compaction.
    recordCompressBlock(SESSION, "msg-dead", {
      blockId: "m0001", nodeId: "n1", label: "contexthistory:ses-test:0", summary: "s1", topic: "old",
    });
    recordCompressBlock(SESSION, "msg-live", {
      blockId: "m0002", nodeId: "n2", label: "contexthistory:ses-test:0", summary: "s2", topic: "new",
    });

    const config = makeConfig();
    const handler = createContextCompressTransformHandler(store, config, { value: SESSION });
    // Compaction fires; the view only contains msg-live (and the compaction msg).
    const output = { messages: [
      { info: { type: "compaction", id: "cmp-1" }, parts: [] },
      makeMessage("msg-live", "assistant", "still in view"),
    ] };
    await handler["chat.messages.transform"]!({}, output);

    // Dead entry marked, live entry untouched in the registry.
    const parsed = JSON.parse(store.registryContent()) as { entries: Array<{ msgId: string; status: string }> };
    expect(parsed.entries.find(e => e.msgId === "msg-dead")?.status).toBe("compacted");
    expect(parsed.entries.find(e => e.msgId === "msg-live")?.status).toBe("archived");

    // In-memory blocks: dead entry dropped, live entry re-added by the
    // post-clear rebuild (registry is the source of truth).
    expect(getCompressState(SESSION).blocks.has("msg-dead")).toBe(false);
    expect(getCompressState(SESSION).blocks.has("msg-live")).toBe(true);
  });

  test("rebuildCompressState skips compacted-marked entries", async () => {
    forgetCompressSession(SESSION);
    const store = makeRegistryStore([
      { ref: "m0001", msgId: "msg-dead", status: "compacted", summary: "s1", label: "contexthistory:ses-test:0", topic: "old" },
      { ref: "m0002", msgId: "msg-live", status: "archived", summary: "s2", label: "contexthistory:ses-test:0", topic: "new" },
    ]);
    await rebuildCompressState(store, SESSION);
    const blocks = getCompressState(SESSION).blocks;
    expect(blocks.has("msg-dead")).toBe(false);
    expect(blocks.has("msg-live")).toBe(true);
  });

  test("adds pressure directive when context exceeds threshold", async () => {
    const config = {
      contextCompression: { enabled: true, permission: "compress", maxHistoryNodesPerSession: 30, historyTtlDays: 30, nudgePressureThreshold: 0.01 },
      injectionVisibility: { enabled: true, markers: true, digest: true },
    } as unknown as MemConfig;
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    // Big text pushes past the 1% threshold → imperative directive must appear.
    const bigText = "word ".repeat(2000); // ~4000+ tokens ≈ 3% of 128k
    const output = { messages: [makeMessage("msg-1", "user", bigText)] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("PRESSURE at ~");
    expect(joined).toContain("Archive now");
  });

  test("does not add pressure directive when threshold not crossed", async () => {
    const config = makeConfig(); // threshold 0.6 (60%)
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const output = { messages: [makeMessage("msg-1", "user", "small text")] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).not.toContain("PRESSURE at ~");
  });

  test("always-on dashboard appears even with no candidates above threshold", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const output = { messages: [makeMessage("msg-1", "user", "small text")] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("[memory-plugin:context-compress] context ");
    expect(joined).toContain("archived 0");
  });

  test("nudge suggests allFlagged:true for HIGH priority messages", async () => {
    const config = makeConfig();
    const handler = createContextCompressTransformHandler(makeStore(), config, { value: SESSION });
    const bigText = "word ".repeat(7000); // 7000 words → ≥7000 tok under BOTH estimate modes (exact ~1 tok/word, fallback 1.5×) → HIGH (>5000)
    const output = { messages: [
      makeMessage("msg-1", "user", "small"),
      makeMessage("msg-2", "assistant", bigText),
      makeMessage("msg-3", "user", "continue"),
    ] };
    await handler["chat.messages.transform"]!({}, output);
    const texts = (output.messages as Array<{ parts: Array<{ text?: string }> }>).map(m => m.parts[0]?.text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("HIGH priority");
    expect(joined).toContain("allFlagged:true");
  });
});