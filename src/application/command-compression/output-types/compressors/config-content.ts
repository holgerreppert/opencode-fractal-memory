import type { OutputTypeResult } from "../types";

export function compressConfigContent(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  const sections: string[] = [];
  const inSection = new Map<string, number>();
  let currentSection = "(root)";

  for (const line of lines) {
    const t = line.trim();
    const sectionMatch = /^\[([\w\-. ]+)\]$/.exec(t);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      sections.push(currentSection);
      inSection.set(currentSection, 0);
    } else if (t && !t.startsWith("#") && !t.startsWith("//") && t.includes("=")) {
      inSection.set(currentSection, (inSection.get(currentSection) ?? 0) + 1);
    }
  }

  const result: string[] = [];
  result.push(`${sections.length} sections, ${inSection.size > 0 ? Array.from(inSection.values()).reduce((a, b) => a + b, 0) : lines.length} entries`);
  if (sections.length <= 15) {
    for (const s of sections) {
      const count = inSection.get(s) ?? 0;
      result.push(`  [${s}]${count > 0 ? ` (${count} keys)` : ""}`);
    }
  } else {
    result.push(`sections: ${sections.slice(0, 10).join(", ")}${sections.length > 10 ? ` ... +${sections.length - 10} more` : ""}`);
  }

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "config-content", compressed };
}
