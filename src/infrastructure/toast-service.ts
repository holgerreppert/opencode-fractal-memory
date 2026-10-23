import { memLog } from "../logging";
import type { SessionApi } from "../plugin/session-api";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type NotificationMode = "off" | "chat" | "toast";

export interface ToastOptions {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
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
function formatProgressBar(archivedCount: number, totalCount: number, width: number = PROGRESS_BAR_WIDTH): string {
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
  /** Number of messages permanently deleted (no backup). */
  deletedCount?: number;
}

export interface ToastServiceOptions {
  enabled?: boolean;
  defaultDurationMs?: number;
  /** How notifications are surfaced — "chat" (ignored session message, DCP default), "toast", or "off". */
  mode?: NotificationMode;
}

// Notification service over the plugin's session API. Mirrors tarquinen's DCP
// (lib/ui/notification.ts): the default "chat" mode adds a persistent message
// to the session without sending it to the model — visible in the IDE but
// never part of a model request. "toast" mode is unavailable outside a TUI.
export class ToastService {
  private session: SessionApi;
  private enabled: boolean;
  private defaultDurationMs: number;
  private _mode: NotificationMode;

  constructor(session: SessionApi, opts?: ToastServiceOptions) {
    this.session = session;
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

  // DCP-style "chat" notification: injects an ignored text message into the
  // session so the user sees it in the IDE (visible, but excluded from model
  // context and never answered). This is DCP's default pruneNotificationType.
  async sendChatNotification(
    sessionId: string,
    message: string,
    opts?: { agent?: string; title?: string },
  ): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const text = opts?.title ? `${opts.title}\n\n${message}` : message;
      // A synthetic message is added to the session without triggering an
      // agent reply — the notification is visible but never reaches the model.
      await this.session.synthetic({ sessionID: sessionId, text });
      return true;
    } catch (err) {
      memLog("error", "toast", "chat notification failed", { error: err instanceof Error ? err.message : String(err), sessionId });
      return false;
    }
  }

  // Build the DCP-style notification body.
  buildCompressionMessage(opts: CompressionNotification): string {
    const { messageCount, topic, registryLabel, entries, removedChars, summaryChars, totalMessages, deletedCount } = opts;

    const lines: string[] = [];

    // Header with counts.
    const parts: string[] = [];
    if (messageCount > 0) parts.push(`${messageCount} archived`);
    if (deletedCount && deletedCount > 0) parts.push(`${deletedCount} deleted`);
    let header = `▣ archivecontext | ${parts.join(", ") || "no messages processed"}`;
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
      const processed = messageCount + (deletedCount ?? 0);
      lines.push(`  ${formatProgressBar(processed, totalMessages)}  ${processed}/${totalMessages} messages processed`);
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
    if (messageCount > 0) {
      lines.push(`  Archive: ${registryLabel ?? "contexthistory registry"}`);
      lines.push(`  Originals preserved — memory(mode="fetch", label=...)`);
    }
    if (deletedCount && deletedCount > 0) {
      lines.push(`  Deleted content cannot be recovered.`);
    }

    return lines.join("\n");
  }

  // Route a compression notification through the configured mode.
  async notifyCompression(opts: CompressionNotification): Promise<boolean> {
    const { sessionId, agent } = opts;
    if (this._mode === "off") return false;

    const message = this.buildCompressionMessage(opts);

    // The server plugin has no TUI surface, so the "toast" mode falls back to
    // a session message (the only channel available outside the CLI plugin).
    if (this._mode === "toast") {
      memLog("debug", "toast", "toast mode falls back to a session message", { sessionId });
    }
    const chatOpts: { agent?: string } = {};
    if (agent !== undefined) chatOpts.agent = agent;
    return this.sendChatNotification(sessionId, message, chatOpts);
  }
}