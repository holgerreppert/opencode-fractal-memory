import type { OutputTypeResult } from "../types";

export function compressTestOutput(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  let passCount = 0;
  let failCount = 0;
  let totalCount = 0;
  const failures: string[] = [];
  let suiteResult = "";

  for (const line of lines) {
    const t = line.trim();
    if (/^(Tests|Suites|Test Files):/.test(t)) { suiteResult = t; continue; }
    if (/^\d+ passing/.test(t) || /^\d+ failing/.test(t)) { suiteResult = t; continue; }
    if (/^✓|^✔|PASS\s/.test(t)) { passCount++; continue; }
    if (/^✗|^✘|^×|FAIL\s/.test(t)) { failCount++; failures.push(t.slice(0, 200)); continue; }

    if (t.startsWith("ok ") || t.startsWith("not ok ")) {
      totalCount++;
      if (t.startsWith("not ok ")) { failCount++; failures.push(t.slice(0, 200)); }
      else passCount++;
    }
  }

  const result: string[] = [];
  if (suiteResult) result.push(suiteResult);
  else result.push(`tests: ${passCount + failCount} total, ${passCount} passed, ${failCount} failed`);

  if (failures.length > 0) {
    result.push(`failures (${failures.length}):`);
    result.push(...failures.slice(0, 5));
    if (failures.length > 5) result.push(`  ... +${failures.length - 5} more failures`);
  }

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "test-output", compressed };
}
