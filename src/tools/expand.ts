import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRATCH_DIR = path.join(os.homedir(), ".config", "opencode", "scratch");

export function createExpandTool() {
  return tool({
    description:
      "Retrieve a stashed tool output by ref (path from [Original stashed — cat <path>] banner). Supports slice/filter without re-injecting the full dump. Fails open — returns error if ref not found.",
    args: {
      ref: tool.schema.string().describe("Stash path, e.g. /home/.../.config/opencode/scratch/<hash>.out or just <hash>"),
      maxTokens: tool.schema.number().optional().describe("Max tokens to return (~4 chars/token). Default 2000."),
      filter: tool.schema.enum(["all", "error"]).optional().describe("If 'error', return only error lines ±3 context, collapsed repeats."),
      slice: tool.schema.enum(["head", "tail", "full"]).optional().describe("Slice: head 50 lines, tail 50, or full (capped by maxTokens)."),
    },
    async execute(args) {
      let p = args.ref.trim();
      // Allow bare hash
      if (!p.includes("/") && !p.includes(".out")) p = path.join(SCRATCH_DIR, `${p}.out`);
      if (!fs.existsSync(p)) {
        // try with .out extension
        const alt = p.endsWith(".out") ? p : `${p}.out`;
        if (fs.existsSync(alt)) p = alt;
        else return `Error: ref not found: ${args.ref} (looked in ${SCRATCH_DIR})`;
      }
      let raw: string;
      try {
        raw = fs.readFileSync(p, "utf-8");
      } catch (e) {
        return `Error: failed to read ${p}: ${String(e)}`;
      }
      const maxTokens = args.maxTokens ?? 2000;
      const maxChars = maxTokens * 4;
      let out = raw;

      if (args.filter === "error") {
        const lines = raw.split("\n");
        const re = /(ERROR|Error|FAILED|fail|panic|Traceback|Exception|stack trace|test failed|FAIL\s)/i;
        const keep = new Set<number>();
        lines.forEach((l, i) => {
          if (re.test(l)) for (let d = -3; d <= 3; d++) if (i + d >= 0 && i + d < lines.length) keep.add(i + d);
        });
        if (keep.size > 0) {
          const sorted = [...keep].sort((a, b) => a - b);
          out = sorted.map((i) => lines[i]).join("\n");
          out = `[error-filter ${keep.size}/${lines.length} lines]\n` + out;
        }
      } else if (args.slice === "head") out = raw.split("\n").slice(0, 50).join("\n");
      else if (args.slice === "tail") out = raw.split("\n").slice(-50).join("\n");

      if (out.length > maxChars) {
        out = out.slice(0, maxChars / 2) + `\n… [truncated to ~${maxTokens} tok, original ${raw.length} chars at ${p}] …\n` + out.slice(-maxChars / 2);
      } else {
        out += `\n\n[full at ${p} — ${raw.length} chars, showing ${out.length} chars]`;
      }
      return out;
    },
  });
}
