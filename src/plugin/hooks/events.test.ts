import { describe, expect, test } from "bun:test";
import { createEventHandler } from "./events";
import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";

/**
 * The event handler must accept the flat `{type, properties}` shape the
 * registration layer produces (the runtime delivers the payload in `data`).
 * Reading the old nested `{event: {...}}` shape made every event throw
 * `Cannot destructure property 'type' from null or undefined value`.
 */
function makeHandler() {
  const created: string[] = [];
  const store = {
    createSessionMetrics: async (id: string) => {
      created.push(id);
    },
  } as unknown as MemoryStore;
  const config = { sessionLog: { enabled: false } } as MemConfig;
  const managementServer = { start: () => {}, stop: () => {} };
  const hooks = createEventHandler(store, config, undefined, managementServer, "/tmp/v2-events-test");
  return { hooks, created };
}

describe("createEventHandler", () => {
  test("accepts the flat event shape", async () => {
    const { hooks, created } = makeHandler();
    await (hooks.event as (e: unknown) => Promise<void>)({
      type: "session.created",
      properties: { info: { id: "ses_flat_1" } },
    });
    expect(created).toContain("ses_flat_1");
  });

  test("ignores a null event instead of throwing", async () => {
    const { hooks } = makeHandler();
    await expect((hooks.event as (e: unknown) => Promise<void>)(null)).resolves.toBeUndefined();
  });

  test("ignores an event without a type", async () => {
    const { hooks } = makeHandler();
    await expect(
      (hooks.event as (e: unknown) => Promise<void>)({ properties: { sessionID: "ses_x" } }),
    ).resolves.toBeUndefined();
  });
});
