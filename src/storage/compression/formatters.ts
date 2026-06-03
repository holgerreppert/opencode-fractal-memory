import type { MemoryNode } from "../types";

export const LEVEL_FORMATTERS: Record<number, (nodes: MemoryNode[]) => string> = {
  1: (nodes) => {
    const lines = ["## Weekly Summary", ""];
    const byDay = new Map<string, MemoryNode[]>();

    for (const node of nodes) {
      const day = node.createdAt.toISOString().split('T')[0]!;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(node);
    }

    for (const [day, dayNodes] of byDay) {
      lines.push(`### ${day}`);
      for (const n of dayNodes) {
        lines.push(`- ${n.content.slice(0, 100)}...`);
      }
      lines.push("");
    }

    return lines.join("\n");
  },

  2: (nodes) => {
    const lines = ["## Monthly Themes", ""];
    const themes = new Map<string, MemoryNode[]>();

    for (const node of nodes) {
      const theme = node.label ?? node.type ?? "general";
      if (!themes.has(theme)) themes.set(theme, []);
      themes.get(theme)!.push(node);
    }

    for (const [theme, themeNodes] of themes) {
      lines.push(`### ${theme} (${themeNodes.length} items)`);
      for (const n of themeNodes.slice(0, 5)) {
        lines.push(`- ${n.content.slice(0, 80)}...`);
      }
      if (themeNodes.length > 5) {
        lines.push(`  ... and ${themeNodes.length - 5} more`);
      }
      lines.push("");
    }

    return lines.join("\n");
  },

  3: (nodes) => {
    const lines = ["## Quarterly Report", "", "### Key Trends"];

    const sorted = [...nodes].sort((a, b) => b.importance - a.importance);
    for (const node of sorted.slice(0, 10)) {
      lines.push(`- **${node.label ?? "Item"}**: ${node.content.slice(0, 100)}`);
    }

    lines.push("", "### Outcomes");
    const highImportance = nodes.filter(n => n.importance > 0.7);
    lines.push(`- ${highImportance.length} high-priority items identified`);
    lines.push(`- ${nodes.length - highImportance.length} standard items`);
    lines.push("");
    lines.push(`_Summary of ${nodes.length} items_`);

    return lines.join("\n");
  },
};

export function generateSummary(node: MemoryNode): string {
  if (LEVEL_FORMATTERS[node.level]) {
    return LEVEL_FORMATTERS[node.level]!([node]);
  }

  const content = node.content;
  const lines = content.split('\n').filter(l => l.trim());

  if (lines.length <= 5) {
    return content;
  }

  const headingLines = lines.filter(l => l.startsWith('#') || l.startsWith('##'));
  const bulletLines = lines.filter(l => l.startsWith('- ') || l.startsWith('* '));
  const importantLines = lines.filter(l =>
    l.length > 30 &&
    !l.startsWith('#') &&
    !l.startsWith('-')
  );

  const summaryParts: string[] = [];

  if (headingLines.length > 0) {
    summaryParts.push(`Topics covered (${headingLines.length}):`);
    summaryParts.push(...headingLines.slice(0, 5));
    summaryParts.push('');
  }

  if (bulletLines.length > 0) {
    summaryParts.push(`Key points (${bulletLines.length} items):`);
    summaryParts.push(...bulletLines.slice(0, 8));
    if (bulletLines.length > 8) {
      summaryParts.push(`... and ${bulletLines.length - 8} more items`);
    }
  } else if (importantLines.length > 0) {
    summaryParts.push(`Key insights:`);
    summaryParts.push(...importantLines.slice(0, 5));
  }

  if (summaryParts.length === 0) {
    const firstFew = lines.slice(0, 3);
    const lastFew = lines.slice(-2);
    summaryParts.push(`Summary of ${lines.length} lines:`);
    summaryParts.push(...firstFew);
    summaryParts.push(`... (${lines.length - 5} more lines)`);
    summaryParts.push(...lastFew);
  }

  return summaryParts.join('\n');
}

export function generateStructuredSummary(nodes: MemoryNode[]): string {
  const allContent = nodes.map(n => n.content).join('\n\n');
  const lines = allContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const decisions: string[] = [];
  const files: string[] = [];
  const patterns: string[] = [];
  const nextSteps: string[] = [];
  const concepts: string[] = [];
  const tools: string[] = [];

  const filePattern = /\b[\w-]+\.(ts|js|tsx|jsx|py|md|json|yml|yaml|sql|sh)\b/gi;
  const toolPattern = /\b(memory_\w+|journal_\w+|bash|git|npm|bun|tsc|test)\b/gi;
  const decisionPatterns = [
    /decides?:?\s*/i,
    /chose\s+\w+/i,
    /agreed\s+(to|that)/i,
    /settled\s+on/i,
    /opted\s+(for|in)/i,
    /will\s+use/i,
    /using\s+\w+\s+for/i,
  ];
  const nextPatterns = [
    /^[-*]\s*(next|todo|will|should|need to|plan to)/i,
    /next\s+step/i,
    /pending/i,
    /^#+\s*(next|todo|tasks?)/i,
  ];
  const conceptPatterns = [
    /learned:?\s*/i,
    /pattern:?\s*/i,
    /convention:?\s*/i,
    /architecture/i,
    /design\s+decision/i,
  ];

  for (const line of lines) {
    if (decisionPatterns.some(p => p.test(line)) && !decisionPatterns[5]?.test(line.slice(0, 20))) {
      const clean = line.replace(/^[-*#\s]+/, '').slice(0, 120);
      if (clean.length > 20 && !decisions.includes(clean)) {
        decisions.push(clean);
      }
    }

    if (nextPatterns.some(p => p.test(line))) {
      const clean = line.replace(/^[-*#\s]+/, '').slice(0, 120);
      if (clean.length > 10 && !nextSteps.includes(clean)) {
        nextSteps.push(clean);
      }
    }

    if (conceptPatterns.some(p => p.test(line))) {
      const clean = line.replace(/^[-*#\s]+/, '').slice(0, 120);
      if (clean.length > 10 && !patterns.includes(clean)) {
        patterns.push(clean);
      }
    }

    const fileMatches = line.match(filePattern);
    if (fileMatches) {
      for (const f of fileMatches) {
        if (!files.includes(f)) {
          files.push(f);
        }
      }
    }

    const toolMatches = line.match(toolPattern);
    if (toolMatches) {
      for (const t of toolMatches) {
        if (!tools.includes(t)) {
          tools.push(t);
        }
      }
    }
  }

  for (const line of lines.slice(0, 20)) {
    const headingMatch = line.match(/^#+\s+(.+)/);
    if (headingMatch && !headingMatch[1]!.toLowerCase().includes('summary')) {
      const concept = headingMatch[1]!.slice(0, 80);
      if (!concepts.includes(concept)) {
        concepts.push(concept);
      }
    }
  }

  const result: string[] = ['## Structured Summary', ''];

  if (decisions.length > 0) {
    result.push('### Decisions');
    for (const d of decisions.slice(0, 5)) {
      result.push(`- ${d}`);
    }
    if (decisions.length > 5) {
      result.push(`- ... and ${decisions.length - 5} more`);
    }
    result.push('');
  }

  if (files.length > 0) {
    result.push('### Files');
    result.push(`_Modified or referenced: ${files.slice(0, 10).join(', ')}_`);
    if (files.length > 10) {
      result.push(`_... and ${files.length - 10} more_`);
    }
    result.push('');
  }

  if (tools.length > 0) {
    result.push('### Tools');
    result.push(`_${tools.slice(0, 8).join(', ')}_`);
    result.push('');
  }

  if (patterns.length > 0) {
    result.push('### Patterns & Conventions');
    for (const p of patterns.slice(0, 5)) {
      result.push(`- ${p}`);
    }
    result.push('');
  }

  if (concepts.length > 0) {
    result.push('### Topics');
    for (const c of concepts.slice(0, 6)) {
      result.push(`- ${c}`);
    }
    result.push('');
  }

  if (nextSteps.length > 0) {
    result.push('### Next Steps');
    for (const n of nextSteps.slice(0, 5)) {
      result.push(`- ${n}`);
    }
    if (nextSteps.length > 5) {
      result.push(`- ... and ${nextSteps.length - 5} more`);
    }
    result.push('');
  }

  if (decisions.length === 0 && files.length === 0 && patterns.length === 0 && concepts.length === 0 && nextSteps.length === 0) {
    const topics = [...new Set(lines.filter(l => l.startsWith('-') || l.startsWith('*')).map(l => l.replace(/^[-*]\s+/, '').slice(0, 60)))];
    result.push('### Key Points');
    for (const t of topics.slice(0, 8)) {
      result.push(`- ${t}`);
    }
    result.push('');
  }

  result.push(`_Compressed from ${nodes.length} node(s)_`);

  return result.join('\n');
}

export function generateLLMSummaryPrompt(node: MemoryNode): string {
  return `Create a concise summary of the following memory content. Focus on the key points and essential information. Keep it under 200 words.

Memory content:
---
${node.content}
---

Summary:`;
}
