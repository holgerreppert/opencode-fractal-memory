export function compressTestOutput(raw: string): string {
  const lines = raw.split("\n");
  const fails: string[] = [];
  let passed = 0;
  let failed = 0;
  let total = 0;

  const passRe = /^(ok|PASS|\.|✓|√)\s*/;
  const failRe = /^(FAIL|FAILED|not ok|✗|×)\s*/;
  const summaryRe = /(\d+)\s+(test|tests?|passed|failed|run)/i;

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    if (failRe.test(clean) || clean.includes("FAILED") || clean.includes("FAIL ")) {
      failed++;
      fails.push(clean.replace(failRe, "").trim());
    } else if (passRe.test(clean)) {
      passed++;
    }

    const m = summaryRe.exec(clean);
    if (m) total = Math.max(total, parseInt(m[1] ?? "0", 10));
  }

  if (failed === 0 && passed === 0 && total === 0) return raw;

  if (failed > 0) {
    return `${failed} test${failed !== 1 ? "s" : ""} failed:\n${fails.slice(0, 10).map(f => `  FAIL: ${f}`).join("\n")}${fails.length > 10 ? `\n  ... +${fails.length - 10} more` : ""}`;
  }

  return total > 0 ? `${total - failed}/${total} passed` : `${passed} passed`;
}
