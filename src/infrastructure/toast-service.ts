import { memLog } from "../logging";

export type ToastVariant = "info" | "success" | "warning" | "error";

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
}

const TOAST_BODY_MAX_CHARS = 600;

function truncateToastBody(message: string, maxChars: number = TOAST_BODY_MAX_CHARS): string {
  if (message.length <= maxChars) return message;
  return message.slice(0, maxChars - 3) + "...";
}

export interface ToastServiceOptions {
  enabled?: boolean;
  defaultDurationMs?: number;
}

export class ToastService {
  private client: ToastClientLike;
  private enabled: boolean;
  private defaultDurationMs: number;

  constructor(client: unknown, opts?: ToastServiceOptions) {
    this.client = (client ?? {}) as ToastClientLike;
    this.enabled = opts?.enabled ?? true;
    this.defaultDurationMs = opts?.defaultDurationMs ?? 5000;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // Low-level toast — safe no-op when the client lacks tui.showToast or the
  // service is disabled. Returns true when the toast was actually shown.
  async showToast(opts: ToastOptions): Promise<boolean> {
    if (!this.enabled) return false;
    const show = this.client?.tui?.showToast;
    if (typeof show !== "function") {
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
      await show({ body });
      return true;
    } catch (err) {
      memLog("error", "toast", "showToast failed", { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  // DCP-style compression notification (see lib/ui/notification.ts
  // sendCompressNotification in opencode-dynamic-context-pruning).
  async notifyCompression(opts: {
    messageCount: number;
    topic?: string;
    registryLabel?: string;
    variant?: ToastVariant;
  }): Promise<boolean> {
    const { messageCount, topic, registryLabel, variant } = opts;
    const lines = [
      `▣ archivecontext | ${messageCount} message(s) archived`,
      `→ Topic: ${topic ?? "(batch)"}`,
      `→ Archive: ${registryLabel ?? "contexthistory registry"}`,
      `→ Originals preserved — fetch via memory(mode="fetch", label=...)`,
    ];
    return this.showToast({
      title: "archivecontext: Compression",
      message: lines.join("\n"),
      variant: variant ?? "info",
    });
  }
}
