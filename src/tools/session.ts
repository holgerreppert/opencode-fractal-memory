import { tool } from "@opencode-ai/plugin";
import type { MemoryStore } from "../storage/sqlite";
import { estimateTokens } from "../infrastructure/llm/embeddings";
import { CONTEXT_LIMIT, wrapWithTracking } from "./shared";

export function MemorySessionStats(store: MemoryStore) {
  const t = tool({
    description: "Get statistics about the current session's tool calls. Use session_id to query a specific session.",
    args: {
      session_id: tool.schema.string().optional().describe("Session ID to query. If not provided, attempts to get current session."),
    },
    async execute(args) {
      const sessionId = args.session_id as string | undefined;

      if (!sessionId) {
        return "No session_id provided. Pass a session ID to query specific session stats.";
      }

      const stats = await store.getSessionStats(sessionId);

      if (!stats) {
        return `No data found for session: ${sessionId}`;
      }

      const lines: string[] = [];
      lines.push(`## Session: ${stats.sessionId}`);
      lines.push(`**Status:** ${stats.status}`);
      lines.push(`**Started:** ${new Date(stats.startedAt).toLocaleString()}`);
      if (stats.endedAt) {
        const duration = Math.round((stats.endedAt - stats.startedAt) / 1000 / 60);
        lines.push(`**Duration:** ${duration} minutes`);
      }
      lines.push("");

      lines.push("## Tool Usage Summary");
      lines.push(`- Total calls: ${stats.totalToolCalls}`);
      lines.push(`- File reads: ${stats.fileReads}`);
      lines.push(`- File edits: ${stats.fileEdits}`);
      lines.push(`- Bash commands: ${stats.bashCommands}`);
      lines.push(`- Memory tools: ${stats.memoryTools}`);
      lines.push(`- Failed tools: ${stats.failedTools}`);
      lines.push("");

      if (stats.uniqueFilesTouched.length > 0) {
        lines.push("## Files Touched");
        lines.push(stats.uniqueFilesTouched.slice(0, 20).map(f => `- ${f}`).join("\n"));
        if (stats.uniqueFilesTouched.length > 20) {
          lines.push(`_...and ${stats.uniqueFilesTouched.length - 20} more_`);
        }
        lines.push("");
      }

      if (stats.injectionCount > 0) {
        lines.push("## Memory Correlation");
        lines.push(`- Injections: ${stats.injectionCount}`);
        lines.push(`- Tokens injected: ${stats.injectedTokens}`);
        lines.push("");
      }

      if (stats.toolCalls.length > 0) {
        lines.push("## Recent Tool Calls");
        const recentCalls = stats.toolCalls.slice(-20);
        for (const tc of recentCalls) {
          const time = new Date(tc.timestamp).toLocaleTimeString();
          const success = tc.success === false ? "❌" : tc.success === true ? "✓" : "?";
          let entry = `${time} ${success} ${tc.toolName}`;
          if (tc.filePath) entry += ` (${tc.filePath})`;
          if (tc.command) entry += ` - ${tc.command.substring(0, 50)}`;
          lines.push(entry);
        }
      }

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_session_stats");
}

export function MemoryTotalTokens(store: MemoryStore, client: unknown) {
  const t = tool({
    description: "Get complete token analysis including both memory nodes and conversation history. Shows memory tokens, conversation tokens, and total usage against context limit.",
    args: {
      session_id: tool.schema.string().optional().describe("Session ID to analyze. If not provided, uses current session."),
      include_messages: tool.schema.boolean().optional().describe("Include per-message token breakdown (default: false)").default(false),
    },
    async execute(args, toolCtx) {
      const sessionId = args.session_id ?? toolCtx.sessionID;
      
      if (!sessionId) {
        return "No session ID provided. Please provide a session_id or run within a session context.";
      }

      const memoryNodes = await store.listNodes("all");
      const memoryTokensByLevel: Record<number, number> = {};
      let totalMemoryTokens = 0;
      
      for (const node of memoryNodes) {
        const tokens = estimateTokens(node.content);
        memoryTokensByLevel[node.level] = (memoryTokensByLevel[node.level] || 0) + tokens;
        totalMemoryTokens += tokens;
      }

      const conversationTokens = {
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      };
      let messageCount = 0;
      const messageBreakdown: Array<{
        id: string;
        role: string;
        tokens: { input: number; output: number; reasoning: number };
        cost: number;
      }> = [];

      try {
        const messagesResponse = await (client as { session?: { messages: (opts: unknown) => Promise<unknown> } })?.session?.messages({
          path: { id: sessionId },
        });

        if (messagesResponse && Array.isArray(messagesResponse)) {
          for (const { info: message } of messagesResponse) {
            if (message.role === "assistant") {
              messageCount++;
              
              const tokens = message.tokens || { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
              conversationTokens.input += tokens.input || 0;
              conversationTokens.output += tokens.output || 0;
              conversationTokens.reasoning += tokens.reasoning || 0;
              conversationTokens.cacheRead += tokens.cache?.read || 0;
              conversationTokens.cacheWrite += tokens.cache?.write || 0;
              
              if (args.include_messages) {
                messageBreakdown.push({
                  id: message.id.slice(0, 8),
                  role: message.role,
                  tokens: {
                    input: tokens.input || 0,
                    output: tokens.output || 0,
                    reasoning: tokens.reasoning || 0,
                  },
                  cost: message.cost || 0,
                });
              }
            }
          }
          
          conversationTokens.total = conversationTokens.input + conversationTokens.output + 
            conversationTokens.reasoning + conversationTokens.cacheRead + conversationTokens.cacheWrite;
        }
      } catch (err) {
        // If we can't fetch messages, just show memory tokens
      }

      const totalTokens = totalMemoryTokens + conversationTokens.total;
      const percentage = (totalTokens / CONTEXT_LIMIT * 100).toFixed(1);

      const lines: string[] = [];
      lines.push("## Complete Token Analysis");
      lines.push(`**Session:** ${sessionId.slice(0, 8)}`);
      lines.push("");

      lines.push("### Memory System Tokens");
      lines.push(`**Total Memory:** ${totalMemoryTokens.toLocaleString()} tokens`);
      
      const levelNames: Record<number, string> = { 0: "L0 (raw)", 1: "L1", 2: "L2", 3: "L3", 4: "L4", 5: "L5" };
      for (const [level, tokens] of Object.entries(memoryTokensByLevel)) {
        const levelNum = parseInt(level);
        const name = levelNames[levelNum] || `L${level}`;
        const pct = ((tokens / totalMemoryTokens) * 100).toFixed(1);
        lines.push(`- ${name}: ${tokens.toLocaleString()} tokens (${pct}%)`);
      }
      lines.push("");

      lines.push("### Conversation Tokens");
      lines.push(`**Total Conversation:** ${conversationTokens.total.toLocaleString()} tokens (${messageCount} messages)`);
      lines.push(`- Input tokens: ${conversationTokens.input.toLocaleString()}`);
      lines.push(`- Output tokens: ${conversationTokens.output.toLocaleString()}`);
      lines.push(`- Reasoning tokens: ${conversationTokens.reasoning.toLocaleString()}`);
      lines.push(`- Cache read tokens: ${conversationTokens.cacheRead.toLocaleString()}`);
      lines.push(`- Cache write tokens: ${conversationTokens.cacheWrite.toLocaleString()}`);
      lines.push("");

      lines.push("### Summary");
      lines.push(`**Total Tokens:** ${totalTokens.toLocaleString()} / ${CONTEXT_LIMIT.toLocaleString()} (${percentage}%)`);
      lines.push(`- Memory: ${((totalMemoryTokens / totalTokens) * 100).toFixed(1)}%`);
      lines.push(`- Conversation: ${((conversationTokens.total / totalTokens) * 100).toFixed(1)}%`);
      lines.push("");

      const contextRatio = totalTokens / CONTEXT_LIMIT;
      if (contextRatio >= 0.8) {
        lines.push("**⚠️ CRITICAL:** Context at " + (contextRatio * 100).toFixed(0) + "%. Run `memory_compress` immediately!");
      } else if (contextRatio >= 0.6) {
        lines.push("**⚠️ WARNING:** Context at " + (contextRatio * 100).toFixed(0) + "%. Consider running `memory_compress`.");
      } else if (contextRatio >= 0.4) {
        lines.push("**ℹ️ INFO:** Context at " + (contextRatio * 100).toFixed(0) + "%. Monitor and compress if needed.");
      } else {
        lines.push("**✅ OK:** Context at " + (contextRatio * 100).toFixed(0) + "%. Well within limits.");
      }

      if (args.include_messages && messageBreakdown.length > 0) {
        lines.push("");
        lines.push("### Message Breakdown (Top 10)");
        const topMessages = messageBreakdown.slice(-10);
        for (const msg of topMessages) {
          const msgTotal = msg.tokens.input + msg.tokens.output + msg.tokens.reasoning;
          lines.push(`- ${msg.id}: ${msgTotal.toLocaleString()} tokens (in:${msg.tokens.input.toLocaleString()} out:${msg.tokens.output.toLocaleString()} reason:${msg.tokens.reasoning.toLocaleString()})`);
        }
      }

      return lines.join("\n");
    },
  });
  return wrapWithTracking(t, store, "memory_total_tokens");
}