import { memLog } from "../../logging";
import type { HookHandler } from "./types";

// DCP-style hallucination stripping: once the plugin injects [message <id>]
// markers and [Compressed conversation section] placeholders into the context,
// the model WILL imitate them in its text output (prompt-injection-style
// noise). Assistant output should never contain these markers — they live only
// in injected user messages — so strip all occurrences from streamed text.

const MESSAGE_MARKER_RE = /\[message\s+[^\]]+\]\s*/g;
const COMPRESSED_SECTION_RE = /\[Compressed conversation section\]\s*/g;
const MEMORY_PLUGIN_TAG_RE = /\[memory-plugin:context-compress[^\]]*\]\s*/g;

export function stripHallucinatedCompressMarkers(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(MESSAGE_MARKER_RE, "");
  out = out.replace(COMPRESSED_SECTION_RE, "");
  out = out.replace(MEMORY_PLUGIN_TAG_RE, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

export function createTextCompleteHandler(): HookHandler {
  return {
    "text.complete": async (_input: unknown, output: unknown) => {
      const out = output as { text?: string };
      if (typeof out.text !== "string" || out.text.length === 0) return;
      const stripped = stripHallucinatedCompressMarkers(out.text);
      if (stripped !== out.text) {
        memLog("debug", "context-compress", "Stripped hallucinated compress markers from text", {
          removed: out.text.length - stripped.length,
        });
        out.text = stripped;
      }
    },
  };
}