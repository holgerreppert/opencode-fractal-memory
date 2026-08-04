import { describe, expect, test, beforeEach } from "bun:test";
import { createInjectionDigestHandler } from "./injection-digest";
import { recordInjection, resetInjectionLedger, peekInjectionLedger } from "../../application/injection-visibility";
import type { MemConfig } from "../../infrastructure/config/config";
import type { MemoryStore } from "../../storage/sqlite";

function makeConfig(enabled: boolean): MemConfig {
  return { injectionVisibility: { enabled: true, markers: true, digest: enabled } } as MemConfig;
}

function makeStore(record?: (sid: string, data: Record<string, unknown>) => void): MemoryStore {
  const store = {} as MemoryStore;
  store.logInjectionMetrics = async (sid: string, data: any) => { store["logged"] = store["logged"] || []; (store["logged"] as any[]).push({ sid, data }); record?.(sid, data); };
  return store;
}

beforeEach(() => {
  resetInjectionLedger();
});

describe("createInjectionDigestHandler", () => {
  test("returns empty handler when digest disabled", () => {
    const handler = createInjectionDigestHandler(makeStore(), makeConfig(false), { value: "s1" });
    expect(Object.keys(handler)).toHaveLength(0);
  });

  test("injects digest synthetic message summarizing recorded injections", async () => {
    const handler = createInjectionDigestHandler(makeStore(), makeConfig(true), { value: "s1" });
    const transform = handler["chat.messages.transform"];
    expect(transform).toBeDefined();

    recordInjection(makeConfig(true), "compression", "100→20 chars");
    recordInjection(makeConfig(true), "seed-rules", "3 rule(s)");

    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "hello" }] },
      ],
    };

    await transform!({} as any, output as any);

    expect(output.messages).toHaveLength(3);
    const injected = output.messages[1]!;
    expect(injected.info?.role).toBe("user");
    expect(injected.parts[0]?.text).toContain("[memory-plugin:digest]");
    expect(injected.parts[0]?.text).toContain("compression");
    expect(injected.parts[0]?.text).toContain("seed-rules");
    expect(peekInjectionLedger()).toHaveLength(0);
  });

  test("persists drained records to injection_metrics grouped per-feature", async () => {
    const logged: Array<{ sid: string; data: Record<string, unknown> }> = [];
    const store = makeStore((sid, data) => logged.push({ sid, data }));
    const handler = createInjectionDigestHandler(store, makeConfig(true), { value: "s1" });
    const transform = handler["chat.messages.transform"]!;

    recordInjection(makeConfig(true), "graph-context", "skeleton on a.ts");
    recordInjection(makeConfig(true), "graph-context", "skeleton on b.ts");
    recordInjection(makeConfig(true), "re-read-elimination", "cached src/c.ts");

    const output = { messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] }] };
    await transform({} as any, output as any);

    const graph = logged.find(l => l.data.injectionMode === "graph-context");
    expect(graph).toBeDefined();
    expect(graph!.sid).toBe("s1");
    expect(graph!.data.injectedNodeCount).toBe(2);
    expect(graph!.data.injectedTokens).toBeGreaterThan(0);
    expect(logged.some(l => l.data.injectionMode === "re-read-elimination")).toBe(true);
    expect(peekInjectionLedger()).toHaveLength(0);
  });

  test("injects nothing when ledger empty", async () => {
    const handler = createInjectionDigestHandler(makeStore(), makeConfig(true), { value: "s1" });
    const transform = handler["chat.messages.transform"]!;
    const output = {
      messages: [
        { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
      ],
    };
    await transform({} as any, output as any);
    expect(output.messages).toHaveLength(1);
  });
});
