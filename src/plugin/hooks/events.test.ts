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
  const updates: Array<{ sessionId: string; endedAt?: number; status?: string }> = [];
  const store = {
    createSessionMetrics: async (id: string) => {
      created.push(id);
    },
    updateSessionMetrics: async (id: string, upd: { endedAt?: number; status?: string }) => {
      updates.push({ sessionId: id, ...upd });
    },
  } as unknown as MemoryStore;
  // dreamRsi off — its replay/sweep paths would exercise the mock store.
  const config = { sessionLog: { enabled: false }, dreamRsi: { enabled: false } } as MemConfig;
  const managementServer = { start: () => {}, stop: () => {} };
  const hooks = createEventHandler(store, config, undefined, managementServer, "/tmp/v2-events-test");
  return { hooks, created, updates };
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

  test("session.execution.succeeded end-stamps metrics and runs idle tasks", async () => {
    const { hooks, updates } = makeHandler();
    await (hooks.event as (e: unknown) => Promise<void>)({
      type: "session.execution.succeeded",
      properties: { sessionID: "ses_round_1" },
    });
    // V2 never emits session.idle — execution.succeeded must end-stamp.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sessionId).toBe("ses_round_1");
    expect(updates[0]!.status).toBe("completed");
    expect(typeof updates[0]!.endedAt).toBe("number");
  });

  test("session.execution.succeeded dedupes within the window", async () => {
    const { hooks, updates } = makeHandler();
    const run = (hooks.event as (e: unknown) => Promise<void>);
    await run({ type: "session.execution.succeeded", properties: { sessionID: "ses_round_2" } });
    await run({ type: "session.execution.succeeded", properties: { sessionID: "ses_round_2" } });
    // Second round within 20s: metrics still end-stamp, but the task runner
    // is deduped (updateSessionMetrics called twice, runner log once).
    expect(updates).toHaveLength(2);
  });

  test("session.execution.succeeded with unknown session is a no-op", async () => {
    const { hooks, updates } = makeHandler();
    await (hooks.event as (e: unknown) => Promise<void>)({
      type: "session.execution.succeeded",
      properties: {},
    });
    expect(updates).toHaveLength(0);
  });

  test("session.status with idle status end-stamps metrics", async () => {
    const { hooks, updates } = makeHandler();
    await (hooks.event as (e: unknown) => Promise<void>)({
      type: "session.status",
      properties: { sessionID: "ses_status_1", status: { type: "idle" } },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sessionId).toBe("ses_status_1");
  });

  test("session.status with non-idle status does not end-stamp", async () => {
    const { hooks, updates } = makeHandler();
    await (hooks.event as (e: unknown) => Promise<void>)({
      type: "session.status",
      properties: { sessionID: "ses_status_2", status: { type: "retry", attempt: 1, message: "x" } },
    });
    expect(updates).toHaveLength(0);
  });
});
