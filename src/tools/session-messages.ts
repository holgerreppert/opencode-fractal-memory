import { tool } from "@opencode-ai/plugin";
import { memLog } from "../logging";
import {
  estimateMessageTokens,
  realMessageTokens,
  partPayloadText,
  partTypeChars,
  type SizableMessage,
} from "../application/context-compression/message-size";

const SNIPPET_MAX = 200;

// List session messages ordered by context cost (real provider token counts
// when available, part-payload estimation otherwise) and search their
// content. Uses the SDK client.session.messages() — no direct DB access.
export function createSessionMessagesTool(client: unknown) {
  return tool({
    description: `List the messages in the current session ordered by how much context they consume (largest first), and optionally search message content. Sizes come from real provider token counts (info.tokens) when available, otherwise from part-payload estimation — text, reasoning, tool outputs and file contents are all counted. Useful to find which messages are worth compressing with archivecontext, or to locate a specific tool output / reasoning trace by content.

Args:
  limit: max number of messages to return (default 10)
  pattern: optional substring to search across message content (text, reasoning, tool outputs, file contents); only matching messages are returned
  minTokens: optional lower bound on message size in tokens (default 0)`,
    args: {
      limit: tool.schema.number().optional().describe("Max number of messages to return (default 10)"),
      pattern: tool.schema.string().optional().describe("Substring to search across message content"),
      minTokens: tool.schema.number().optional().describe("Minimum message size in tokens"),
    },
    async execute(args, toolCtx) {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return "No session ID available — run within a session.";
      }

      const typedClient = client as { session?: { messages: (opts: unknown) => Promise<{ data?: Array<SizableMessage>; [key: string]: unknown }> } };
      if (!typedClient?.session?.messages) {
        return "SDK client session.messages() is not available.";
      }

      let messages: SizableMessage[] = [];
      try {
        const response = await typedClient.session.messages({ path: { id: sessionId } });
        messages = ((response?.data ?? response) as unknown as SizableMessage[]) ?? [];
      } catch (err) {
        memLog("warn", "session-messages", "session.messages() failed", { error: String(err) });
        return `Error: session.messages() failed: ${String(err)}`;
      }

      const pattern = args.pattern;
      const minTokens = args.minTokens ?? 0;
      const limit = Math.max(1, Math.min(args.limit ?? 10, 50));

      const sized = messages
        .map((msg) => {
          const real = realMessageTokens(msg);
          const estimated = estimateMessageTokens(msg);
          const tokens = real !== null ? real : estimated;
          const text = msg.parts?.map((p) => partPayloadText(p)).join("\n") ?? "";
          return { msg, real, estimated, tokens, text };
        })
        .filter((m) => m.tokens >= minTokens)
        .filter((m) => !pattern || m.text.includes(pattern))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, limit);

      if (sized.length === 0) {
        return `No messages match (pattern${pattern ? ` "${pattern}"` : ""}${minTokens ? `, min ${minTokens} tok` : ""}).`;
      }

      const total = sized.reduce((acc, m) => acc + m.tokens, 0);
      const lines = [
        `## Session messages by context cost (${sized.length} of ${messages.length} shown, ~${total.toLocaleString()} tok total)`,
        "",
      ];
      for (const m of sized) {
        const id = m.msg.info?.id ?? "?";
        const role = m.msg.info?.role ?? "?";
        const sizeTag = m.real !== null ? `real ${m.real.toLocaleString()}` : `est ${m.estimated.toLocaleString()}`;
        const types = Object.entries(partTypeChars(m.msg))
          .filter(([, chars]) => chars > 0)
          .map(([t, chars]) => `${t}:${(chars / 1024).toFixed(0)}KB`)
          .join(" ");
        lines.push(`- [message ${id}] (${role}) ~${m.tokens.toLocaleString()} tok (${sizeTag}) ${types ? `| ${types}` : ""}`);
        const snippet = m.text.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX);
        if (snippet) lines.push(`    ${snippet}${m.text.length > SNIPPET_MAX ? "…" : ""}`);
      }
      lines.push("", "Compress any of these with archivecontext (messageId = the id shown above). Originals are preserved.");
      return lines.join("\n");
    },
  });
}