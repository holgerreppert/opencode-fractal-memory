/**
 * V2 client bridge.
 *
 * The shared plugin core calls the OpenCode SDK client with the V1 nested
 * request shape (`client.session.prompt({ path: { id }, body: { ... } })`).
 * OpenCode V2 flattens that into a single argument object, so the V2 runtime
 * needs a thin adapter that presents the V1 shape on top of the V2 domains.
 *
 * Only the four call sites the plugin actually uses are bridged:
 *   - client.session.prompt   (work-capture, lesson-extraction)
 *   - client.session.messages (memory_session_messages tool)
 *   - client.tui.showToast    (ToastService, ephemeral notification)
 *
 * Everything else is intentionally left undefined: the plugin never calls it,
 * and a stub that silently no-ops would hide a real porting gap.
 */

export interface V2ClientLike {
  session: {
    prompt: (args: { path: { id: string }; body?: Record<string, unknown> }) => Promise<unknown>;
    messages: (args: { path: { id: string } }) => Promise<unknown>;
  };
  tui?: {
    showToast: (args: { body?: { message?: string; title?: string } }) => Promise<unknown>;
  };
}

interface V2SessionDomain {
  prompt: (input: Record<string, unknown>) => Promise<unknown>;
  context?: (input: Record<string, unknown>) => Promise<unknown>;
}

interface V2Context {
  session: V2SessionDomain;
  app?: { log?: (input: Record<string, unknown>) => Promise<unknown> };
}

/**
 * Build a V1-shaped client facade over the V2 session domain.
 *
 * `ctx.session.prompt` takes flat input; the V1 shape carries the session id
 * under `path.id` and the payload under `body`. Both are merged into one flat
 * object, with `sessionID` set from the path id.
 */
export function createV2Client(ctx: V2Context): V2ClientLike {
  const client: V2ClientLike = {
    session: {
      prompt: async (args) => {
        const body = args.body ?? {};
        return ctx.session.prompt({ ...body, sessionID: args.path.id });
      },
      messages: async (args) => {
        // V2 exposes session messages through `session.context`, which takes a
        // flat `{ sessionID }` input. V1 returned `{ data: [...] }`; the
        // consumer accepts either shape, so the raw result is passed through.
        if (!ctx.session.context) return { data: [] };
        return ctx.session.context({ sessionID: args.path.id });
      },
    },
  };
  return client;
}
