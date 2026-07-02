import type { AnalysisResult } from "./analyze";

export function generateReport(analysis: AnalysisResult): string {
  const lines: string[] = [
    "# Code Graph Report",
    "",
    "## Overview",
    "| Metric | Count |",
    "|--------|-------|",
    `| Files | ${analysis.stats.files} |`,
    `| Symbols | ${analysis.stats.symbols} |`,
    `| Relationships | ${analysis.stats.edges} |`,
    `| Communities | ${analysis.stats.communities} |`,
    "",
  ];

  if (analysis.godNodes.length > 0) {
    lines.push("## God Nodes (Most Connected)", "");
    for (const gn of analysis.godNodes) {
      const loc = gn.node.file
        ? ` (\`${gn.node.file}\`:${gn.node.line ?? "?"})`
        : "";
      lines.push(`- **${gn.node.label}** — degree ${gn.degree}${loc}`);
    }
    lines.push("");
  }

  if (analysis.surprisingConnections.length > 0) {
    lines.push("## Surprising Connections", "");
    for (const sc of analysis.surprisingConnections) {
      lines.push(
        `- \`${sc.source.label}\` **${sc.relation}** \`${sc.target.label}\` ` +
        `(${sc.source.community ?? "?"} ↔ ${sc.target.community ?? "?"})`,
      );
    }
    lines.push("");
  }

  if (analysis.suggestedQuestions.length > 0) {
    lines.push("## Suggested Questions", "");
    for (const q of analysis.suggestedQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
