import { memLog } from "../logging";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type NotificationMode = "off" | "chat" | "toast";

export interface ToastOptions {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ToastClientLike {
  tui?: {
    showToast?: (opts: { body: { title?: string; message: string; variant: ToastVariant; duration?: number } }) => Promise<unknown>;
  };
  session?: {
    prompt?: (opts: unknown) => Promise<unknown>;
  };
}

const TOAST_BODY_MAX_CHARS = 600;

function truncateToastBody(message: string, maxChars: number = TOAST_BODY_MAX_CHARS): string {
  if (message.length <= maxChars) return message;
  return message.slice(0, maxChars - 3) + "...";
}

export interface ToastServiceOptions {
  enabled?: boolean;
  defaultDurationMs?: number;
  /** How notifications are surfaced — "chat" (ignored session message, DCP default), "toast", or "off". */
  mode?: NotificationMode;
}

// Notification service wrapping the OpenCode client. Mirrors tarquinen's DCP
// (lib/ui/notification.ts): the default "chat" mode injects a persistent
// *ignored* text message into the session via client.session.prompt with
// noReply — visible in the IDE but not sent to the model. "toast" mode uses
// client.tui.showToast (ephemeral, requires a TUI-bound client).
export class ToastService {
  private client: ToastClientLike;
  private enabled: boolean;
  private defaultDurationMs: number;
  private _mode: NotificationMode;

  constructor(client: unknown, opts?: ToastServiceOptions) {
    this.client = (client ?? {}) as ToastClientLike;
    this.enabled = opts?.enabled ?? true;
    this.defaultDurationMs = opts?.defaultDurationMs ?? 5000;
    this._mode = opts?.mode ?? "chat";
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get mode(): NotificationMode {
    return this._mode;
  }

  // Low-level toast — safe no-op when the client lacks tui.showToast or the
  // service is disabled. Returns true when the toast was actually shown.
  async showToast(opts: ToastOptions): Promise<boolean> {
    if (!this.enabled) return false;
    const tui = this.client?.tui;
    if (!tui || typeof tui.showToast !== "function") {
      memLog("debug", "toast", "tui.showToast unavailable", { title: opts.title });
      return false;
    }
    try {
      const body: { title?: string; message: string; variant: ToastVariant; duration?: number } = {
        message: truncateToastBody(opts.message),
        variant: opts.variant ?? "info",
        duration: opts.durationMs ?? this.defaultDurationMs,
      };
      if (opts.title !== undefined) body.title = opts.title;
      // MUST call as a method on the tui instance — the SDK's showToast reads
      // `this._client`; extracting the fn and calling it detached loses the
      // binding and throws "undefined is not an object (evaluating 'this._client')".
      await tui.showToast({ body });
      return true;
    } catch (err) {
      memLog("error", "toast", "showToast failed", { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  // DCP-style "chat" notification: injects an ignored text message into the
  // session so the user sees it in the IDE (visible, but excluded from model
  // context and never answered). This is DCP's default pruneNotificationType.
  async sendChatNotification(
    sessionId: string,
    message: string,
    opts?: { agent?: string; title?: string },
  ): Promise<boolean> {
    if (!this.enabled) return false;
    const session = this.client?.session;
    if (!session || typeof session.prompt !== "function") {
      memLog("debug", "toast", "session.prompt unavailable", { sessionId });
      return false;
    }
    try {
      const text = opts?.title ? `${opts.title}\n\n${message}` : message;
      const body: { noReply: boolean; agent?: string; parts: Array<{ type: "text"; text: string; ignored: boolean }> } = {
        noReply: true,
        parts: [
          {
            type: "text",
            text,
            ignored: true,
          },
        ],
      };
      if (opts?.agent) body.agent = opts.agent;
      // MUST call as a method on the session instance — the SDK's prompt reads
      // `this._client`; extracting the fn and calling it detached loses the
      // binding and throws "undefined is not an object (evaluating 'this._client')".
      await session.prompt({
        path: { id: sessionId },
        body,
      });
      return true;
    } catch (err) {
      memLog("error", "toast", "chat notification failed", { error: err instanceof Error ? err.message : String(err), sessionId });
      return false;
    }
  }

  // Route a compression notification through the configured mode.
  async notifyCompression(opts: {
    sessionId: string;
    messageCount: number;
    topic?: string;
    registryLabel?: string;
    agent?: string;
    variant?: ToastVariant;
  }): Promise<boolean> {
    const { sessionId, messageCount, topic, registryLabel, agent, variant } = opts;
    if (this._mode === "off") return false;

    const lines = [
      `▣ archivecontext | ${messageCount} message(s) archived`,
      `→ Topic: ${topic ?? "(batch)"}`,
      `→ Archive: ${registryLabel ?? "contexthistory registry"}`,
      `→ Originals preserved — fetch via memory(mode="fetch", label=...)`,
    ];
    const message = lines.join("\n");

    if (this._mode === "toast") {
      return this.showToast({
        title: "archivecontext: Compression",
        message,
        variant: variant ?? "info",
      });
    }
    const chatOpts: { agent?: string } = {};
    if (agent !== undefined) chatOpts.agent = agent;
    return this.sendChatNotification(sessionId, message, chatOpts);
  }
}