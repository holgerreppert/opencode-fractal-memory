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

// --- formatting helpers (mirror DCP lib/ui/utils.ts) -------------------------

const PROGRESS_BAR_WIDTH = 40;

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

// Simple chars/4 estimate — good enough for a notification footer.
export function estimateTokens(chars: number): number {
  return Math.round(chars / 4);
}

// │▓▓▓▓▓▓░░░░░░│ — archived portion shown as ░, remaining as ▓.
export function formatProgressBar(archivedCount: number, totalCount: number, width: number = PROGRESS_BAR_WIDTH): string {
  if (totalCount <= 0) return `│${"▓".repeat(width)}│`;
  const archived = Math.min(archivedCount, totalCount);
  const filled = Math.round((archived / totalCount) * width);
  const bar = "▓".repeat(Math.max(0, width - filled)) + "░".repeat(Math.min(filled, width));
  return `│${bar}│`;
}

export interface CompressionEntry {
  msgRef: string;
  description: string;
  nodeLabel?: string;
}

export interface CompressionNotification {
  sessionId: string;
  messageCount: number;
  topic?: string;
  registryLabel?: string;
  agent?: string;
  variant?: ToastVariant;
  /** Per-message entries, rendered as an itemized list. */
  entries?: CompressionEntry[];
  /** Sum of archived message text (chars) — used for the token-savings line. */
  removedChars?: number;
  /** Sum of summary/placeholder text (chars) — the replacement size. */
  summaryChars?: number;
  /** Total session messages — used for the archive-progress bar. */
  totalMessages?: number;
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

  // Build the DCP-style notification body.
  buildCompressionMessage(opts: CompressionNotification): string {
    const { messageCount, topic, registryLabel, entries, removedChars, summaryChars, totalMessages } = opts;

    const lines: string[] = [];

    // Header with token math.
    let header = `▣ archivecontext | ${messageCount} message${messageCount === 1 ? "" : "s"} archived`;
    if (removedChars !== undefined) {
      const removed = estimateTokens(removedChars);
      const summary = summaryChars !== undefined ? estimateTokens(summaryChars) : 0;
      const savings = Math.max(0, removed - summary);
      header += `  (−${formatTokenCount(removed)} tok, saved ${formatTokenCount(savings)})`;
    }
    lines.push(header);

    if (topic) lines.push(`  Topic: ${topic}`);

    // Archive-progress bar.
    if (totalMessages !== undefined && totalMessages > 0) {
      lines.push(`  ${formatProgressBar(messageCount, totalMessages)}  ${messageCount}/${totalMessages} messages archived`);
    }

    // Per-message itemized list.
    if (entries && entries.length > 0) {
      lines.push("");
      for (const entry of entries) {
        const target = entry.nodeLabel ? ` → ${entry.nodeLabel}` : "";
        lines.push(`  [${entry.msgRef}] "${entry.description}"${target}`);
      }
    }

    // Footer.
    lines.push("");
    lines.push(`  Archive: ${registryLabel ?? "contexthistory registry"}`);
    lines.push(`  Originals preserved — memory(mode="fetch", label=...)`);

    return lines.join("\n");
  }

  // Route a compression notification through the configured mode.
  async notifyCompression(opts: CompressionNotification): Promise<boolean> {
    const { sessionId, agent, variant } = opts;
    if (this._mode === "off") return false;

    const message = this.buildCompressionMessage(opts);

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