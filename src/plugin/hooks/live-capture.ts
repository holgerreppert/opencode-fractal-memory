import type { MemoryStore } from "../../domain/ports/MemoryStore";
import { memLog } from "../../logging";

const TURN_COUNTERS = new Map<string, number>();

function nextTurnIndex(sessionId: string): number {
  const cur = TURN_COUNTERS.get(sessionId) ?? 0;
  TURN_COUNTERS.set(sessionId, cur + 1);
  return cur;
}

export function createLiveCaptureHandler(store: MemoryStore, currentSessionId: { value: string }) {
  return {
    "chat.message": async (_input: unknown, output: unknown) => {
      const sid = currentSessionId.value;
      memLog("debug", "live-capture", "chat.message handler", { sid: sid || "(empty)", hasOutput: !!output, outputKeys: output ? Object.keys(output as object).join(",") : "none" });
      if (!sid) return;

      const out = output as { message?: { role?: string; content?: string }; parts?: Array<{ type?: string; text?: string }> };
      const text = out?.message?.content || "";
      memLog("debug", "live-capture", "chat.message content check", { hasMessage: !!out?.message, textLen: text.length, role: out?.message?.role });
      if (!text) return;

      try {
        const parts = out?.parts || [];
        const tokenCount = parts.reduce((s, p) => s + ((p as any).text?.length ?? 0), 0);
        await store.recordConversationTurn({
          sessionId: sid,
          timestamp: Date.now(),
          turnIndex: nextTurnIndex(sid),
          role: "user",
          content: text,
          tokenCount: Math.round(tokenCount / 4),
        });
        memLog("debug", "live-capture", "Captured user message", {
          sessionId: sid,
          textLen: text.length,
        });
      } catch (e) {
        memLog("error", "live-capture", "Failed to capture user message", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    "chat.messages.transform": async (_input: unknown, output: unknown) => {
      const sid = currentSessionId.value;
      if (!sid) return;

      const out = output as { messages?: Array<{ role?: string; content?: string; parts?: Array<{ type?: string; text?: string }> }> };
      const messages = out?.messages;
      if (!messages || messages.length === 0) return;

      try {
        const assistantMsg = messages[messages.length - 1];
        if (assistantMsg?.role === "assistant") {
          const content = assistantMsg.content || "";
          const parts = assistantMsg.parts || [];
          const partText = parts.map((p: any) => p.text || "").join("");
          const fullContent = content || partText;
          if (fullContent) {
            await store.recordConversationTurn({
              sessionId: sid,
              timestamp: Date.now(),
              turnIndex: nextTurnIndex(sid),
              role: "assistant",
              content: fullContent,
              tokenCount: Math.round(fullContent.length / 4),
            });
            memLog("debug", "live-capture", "Captured assistant message", {
              sessionId: sid,
              textLen: fullContent.length,
            });
          }
        }

        // Check for reasoning in the message parts
        const lastAssistant = messages.filter(m => m.role === "assistant").pop();
        if (lastAssistant) {
          const parts = lastAssistant.parts || [];
          const reasoningPart = parts.find((p: any) => p.type === "reasoning");
          if (reasoningPart?.text) {
            await store.recordConversationTurn({
              sessionId: sid,
              timestamp: Date.now(),
              turnIndex: nextTurnIndex(sid),
              role: "reasoning",
              content: reasoningPart.text,
              tokenCount: Math.round(reasoningPart.text.length / 4),
            });
            memLog("debug", "live-capture", "Captured reasoning", {
              sessionId: sid,
              textLen: reasoningPart.text.length,
            });
          }
        }
      } catch (e) {
        memLog("error", "live-capture", "Failed to capture messages", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    "tool.after": async (input: unknown, _output: unknown) => {
      const sid = currentSessionId.value;
      if (!sid) return;

      const inp = input as { tool?: string; callID?: string; args?: Record<string, unknown> };
      const out = _output as { output?: string; title?: string; metadata?: Record<string, unknown> };

      const toolName = inp?.tool || "";
      if (!toolName) return;

      try {
        const argsPreview = JSON.stringify(inp?.args || {}).slice(0, 500);
        const outputPreview = (out?.output ?? "").slice(0, 500);
        const content = out?.title || `tool:${toolName}`;

        await store.recordConversationTurn({
          sessionId: sid,
          timestamp: Date.now(),
          turnIndex: nextTurnIndex(sid),
          role: "tool",
          content,
          toolName,
          toolArgs: argsPreview,
          toolResult: outputPreview,
          tokenCount: Math.round(outputPreview.length / 4),
        });
      } catch (e) {
        memLog("error", "live-capture", "Failed to capture tool call", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
}
