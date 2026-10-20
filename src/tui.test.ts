import { describe, expect, test } from "bun:test";
import tuiModule, { tui as tuiV1 } from "./tui";

/**
 * Mock V2 TUI context that records the keymap layer and slot claims.
 * Mirrors the V2 API: `ctx.keymap.layer(factory)`, `ctx.ui.slot(claim)`,
 * `ctx.ui.toast.show(options)`.
 */
function createMockTuiCtx() {
  const layers: Array<() => unknown> = [];
  const claims: Array<{ append?: string; render?: (input: unknown) => unknown }> = [];
  const toasts: Array<{ title?: string; message: string; variant?: string }> = [];
  let unregisterCalled = 0;

  const ctx = {
    options: {},
    theme: {
      text: {
        base: "text-base",
        muted: "text-muted",
        action: { primary: { base: "accent" } },
        feedback: {
          success: { base: "ok" },
          error: { base: "err" },
          warning: { base: "warn" },
        },
      },
      border: { base: "border" },
      background: { raised: { base: "panel" } },
    },
    keymap: {
      layer: (factory: () => unknown) => {
        layers.push(factory);
      },
    },
    ui: {
      slot: (claim: { append?: string; render?: (input: unknown) => unknown }) => {
        claims.push(claim);
        return () => {
          unregisterCalled++;
        };
      },
      toast: {
        show: (options: { title?: string; message: string; variant?: string }) => {
          toasts.push(options);
        },
      },
    },
  };

  return { ctx, layers, claims, toasts, unregisterCount: () => unregisterCalled };
}

describe("V2 TUI entrypoint", () => {
  test("exports the dual shape: tui() for V1, setup() for V2", () => {
    expect(typeof tuiV1).toBe("function");
    expect(typeof tuiModule.setup).toBe("function");
    expect(typeof tuiModule.tui).toBe("function");
    // The V1 loader rejects a module exporting BOTH server() and tui().
    expect("server" in tuiModule).toBe(false);
    expect("tui" in tuiModule).toBe(true);
  });

  test("setup registers a keymap layer with the /mem command", async () => {
    const mock = createMockTuiCtx();
    const cleanup = await tuiModule.setup(mock.ctx as never);

    expect(mock.layers.length).toBe(1);
    const layer = mock.layers[0]?.() as {
      mode: string;
      commands: Array<{ id: string; palette?: boolean; slash?: { name: string }; run: () => void }>;
    };
    expect(layer.mode).toBe("global");
    expect(layer.commands.length).toBe(1);
    expect(layer.commands[0]?.id).toBe("mem.status");
    expect(layer.commands[0]?.palette).toBe(true);
    expect(layer.commands[0]?.slash?.name).toBe("mem");
  });

  test("the /mem command shows a status toast", async () => {
    const mock = createMockTuiCtx();
    await tuiModule.setup(mock.ctx as never);

    const layer = mock.layers[0]?.() as { commands: Array<{ run: () => void }> };
    layer.commands[0]?.run();

    expect(mock.toasts.length).toBe(1);
    expect(mock.toasts[0]?.title).toBe("Fractal Memory");
    expect(mock.toasts[0]?.message).toContain("http://localhost:");
  });

  test("setup claims the sidebar.content slot and can unregister it", async () => {
    const mock = createMockTuiCtx();
    const cleanup = await tuiModule.setup(mock.ctx as never);

    expect(mock.claims.length).toBe(1);
    expect(mock.claims[0]?.append).toBe("sidebar.content");
    expect(typeof mock.claims[0]?.render).toBe("function");

    await cleanup();
    expect(mock.unregisterCount()).toBe(1);
  });

  test("setup is a no-op when the plugin is disabled via options", async () => {
    const mock = createMockTuiCtx();
    (mock.ctx as unknown as { options: Record<string, unknown> }).options = { enabled: false };

    const cleanup = await tuiModule.setup(mock.ctx as never);

    expect(mock.layers.length).toBe(0);
    expect(mock.claims.length).toBe(0);
    await cleanup();
  });
});
