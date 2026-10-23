/**
 * Session access for the plugin core.
 *
 * The plugin needs a few things from the runtime: the current session's
 * messages, a way to add a message, and a one-shot text generation for the
 * memory reranker. They are exposed here in runtime terms so no caller has to
 * know the request shape.
 */

import { memLog } from "../logging";
import { projectMessages, type SessionMessage } from "./messages";

/** A model reference, as the runtime names models. */
export interface ModelRef {
  providerID: string;
  id: string;
}

export interface SessionApi {
  /** The messages of a session, normalized for the plugin. */
  messages(input: { sessionID: string }): Promise<SessionMessage[]>;
  /** Add a message to a session. */
  prompt(input: { sessionID: string; text: string }): Promise<unknown>;
  /** Add a message to a session without triggering an agent reply. */
  synthetic(input: { sessionID: string; text: string }): Promise<unknown>;
  /** Generate text with a model, without creating a session or using tools. */
  generate(input: { model: ModelRef; prompt: string }): Promise<string | undefined>;
  /**
   * The model a session most recently replied with.
   *
   * Scans the session's messages newest-first for the first message that
   * records a model — the same model the session itself is using — so one-shot
   * summarization calls (work capture, lessons, distillation) need no model
   * config. Undefined when the session has no assistant message yet or the id
   * is unusable, in which case callers skip the LLM pass gracefully.
   */
  lastModel(sessionID: string): Promise<ModelRef | undefined>;
}

interface SessionDomain {
  context?: (input: { sessionID: string }) => Promise<unknown>;
  prompt?: (input: { sessionID: string; text: string }) => Promise<unknown>;
  synthetic?: (input: { sessionID: string; text: string }) => Promise<unknown>;
}

interface GenerateDomain {
  text?: (input: { model: ModelRef; prompt: string }) => Promise<{ text: string }>;
}

interface ApiContext {
  session: SessionDomain;
  generate?: GenerateDomain;
}

/**
 * A session id the runtime will accept.
 *
 * The SDK brands `SessionID` and validates it on every `session.*` request, so
 * anything else (a missing payload, or the short id some events carry) would
 * throw a Zod error out of the plugin and surface as an opencode error popup.
 * Those failures happen inside the client, before any of our logging, which is
 * why they are invisible in `memory-plugin.log`. Gate them here instead: an
 * unusable id is logged and skipped, never forwarded.
 */
function isUsableSessionID(sessionID: string): boolean {
  if (sessionID.startsWith("ses_")) return true;
  memLog("warn", "session-api", "skipped SDK call: sessionID is not a full opencode id", { sessionID });
  return false;
}

/**
 * Build the plugin's session API over the runtime's session domain.
 */
export function createSessionApi(ctx: ApiContext): SessionApi {
  const messagesOf = async ({ sessionID }: { sessionID: string }): Promise<SessionMessage[]> => {
    if (!ctx.session.context) return [];
    if (!isUsableSessionID(sessionID)) return [];
    const result = await ctx.session.context({ sessionID });
    const list = Array.isArray(result)
      ? result
      : Array.isArray((result as { data?: unknown[] } | undefined)?.data)
        ? (result as { data: unknown[] }).data
        : [];
    return projectMessages(list);
  };

  return {
    messages: messagesOf,
    async prompt(input) {
      if (!ctx.session.prompt) return undefined;
      if (!isUsableSessionID(input.sessionID)) return undefined;
      return ctx.session.prompt(input);
    },
    async synthetic(input) {
      if (!ctx.session.synthetic) return undefined;
      if (!isUsableSessionID(input.sessionID)) return undefined;
      return ctx.session.synthetic(input);
    },
    async generate({ model, prompt }) {
      if (!ctx.generate?.text) return undefined;
      const result = await ctx.generate.text({ model, prompt });
      return result?.text;
    },
    async lastModel(sessionID) {
      const list = await messagesOf({ sessionID });
      for (let i = list.length - 1; i >= 0; i--) {
        const model = list[i]?.model;
        if (!model) continue;
        // Projection renders `providerID/id`; model ids may themselves contain
        // slashes (e.g. openrouter's `anthropic/claude-…`), so split on the first.
        const cut = model.indexOf("/");
        if (cut <= 0 || cut === model.length - 1) continue;
        return { providerID: model.slice(0, cut), id: model.slice(cut + 1) };
      }
      return undefined;
    },
  };
}
