import { memLog } from "../../logging";

export const SIGNAL_PATTERNS = [
  /error/i, /exception/i, /traceback/i, /at\s+\S+\.\S+\(/,
  /FAIL/i, /AssertionError/i, /TypeError/i, /SyntaxError/i,
  /not found/i, /Cannot find/i, /ENOENT/i, /EACCES/i,
  /segmentation fault/i, /signal\s+\d+/i, /killed/i,
  /exit code \d+/i,
];

export function isSignalOutput(raw: string): boolean {
  for (const p of SIGNAL_PATTERNS) {
    if (p.test(raw)) return true;
  }
  return false;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export function contentPreview(text: string, maxLen = 80): string {
  if (!text) return "";
  const first = text.split("\n").find(l => l.trim());
  return first ? first.trim().slice(0, maxLen) : "";
}

export function getCommandPrefix(rawCmd: string): string {
  const cmd = rawCmd.trim();
  const firstPipe = cmd.indexOf("|");
  const firstSegment = firstPipe >= 0 ? cmd.slice(0, firstPipe) : cmd;

  const envPrefix = /^(?:source\s+\S+\s+(?:&&|;)\s*)*(?:cd\s+\S+\s+(?:&&|;)\s*)*(?:source\s+\S+\s+(?:&&|;)\s*)*/;
  return firstSegment.replace(envPrefix, "").trim();
}
