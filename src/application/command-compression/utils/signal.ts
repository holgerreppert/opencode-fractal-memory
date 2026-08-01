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
