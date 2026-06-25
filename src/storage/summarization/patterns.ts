import type { MemoryNode } from "../types";

export function extractPatterns(nodes: MemoryNode[]): {
  files: Map<string, string[]>;
  tools: Map<string, string[]>;
  conventions: Map<string, string[]>;
  preferences: Map<string, string[]>;
  decisions: Map<string, string[]>;
} {
  const files = new Map<string, string[]>();
  const tools = new Map<string, string[]>();
  const conventions = new Map<string, string[]>();
  const preferences = new Map<string, string[]>();
  const decisions = new Map<string, string[]>();

  const filePattern = /\b[\w-]+\.(ts|js|tsx|jsx|py|md|json|yml|yaml|sql|sh|css|html)\b/gi;
  const toolPattern = /\b(memory_\w+|journal_\w+|git|npm|bun|tsc|test|make|cmake|pip|python|node)\b/gi;
  const conventionPatterns = [
    /convention:?\s*/i,
    /standard:?\s*/i,
    /best\s+practice/i,
    /always\s+(use|run|follow)/i,
    /never\s+(use|do)/i,
    /rule:?\s*/i,
  ];
  const preferencePatterns = [
    /user\s+(prefers?|likes?|wants?)/i,
    /prefers?\s+\w+/i,
    /likes?\s+\w+/i,
    /uses?\s+\w+/i,
    /favorite:?\s*/i,
  ];
  const decisionPatterns = [
    /decided?\s+(to|on|that)/i,
    /chose\s+\w+/i,
    /agreed?\s+(to|that)/i,
    /will\s+use/i,
    /using\s+\w+\s+for/i,
  ];

  for (const node of nodes) {
    const contentLines = node.content.split('\n');

    for (const line of contentLines) {
      const fileMatches = line.match(filePattern);
      if (fileMatches) {
        for (const f of fileMatches) {
          const existing = files.get(f) || [];
          if (!existing.includes(node.id)) {
            existing.push(node.id);
            files.set(f, existing);
          }
        }
      }

      const toolMatches = line.match(toolPattern);
      if (toolMatches) {
        for (const t of toolMatches) {
          const existing = tools.get(t) || [];
          if (!existing.includes(node.id)) {
            existing.push(node.id);
            tools.set(t, existing);
          }
        }
      }

      for (const pattern of conventionPatterns) {
        if (pattern.test(line)) {
          const key = line.replace(/^[-*#\s]+/, '').slice(0, 80);
          const existing = conventions.get(key) || [];
          if (!existing.includes(node.id)) {
            existing.push(node.id);
            conventions.set(key, existing);
          }
          break;
        }
      }

      for (const pattern of preferencePatterns) {
        if (pattern.test(line)) {
          const key = line.replace(/^[-*#\s]+/, '').slice(0, 80);
          const existing = preferences.get(key) || [];
          if (!existing.includes(node.id)) {
            existing.push(node.id);
            preferences.set(key, existing);
          }
          break;
        }
      }

      for (const pattern of decisionPatterns) {
        if (pattern.test(line)) {
          const key = line.replace(/^[-*#\s]+/, '').slice(0, 80);
          const existing = decisions.get(key) || [];
          if (!existing.includes(node.id)) {
            existing.push(node.id);
            decisions.set(key, existing);
          }
          break;
        }
      }
    }
  }

  return { files, tools, conventions, preferences, decisions };
}

export function generatePatternSummary(
  patterns: {
    files: Map<string, string[]>;
    tools: Map<string, string[]>;
    conventions: Map<string, string[]>;
    preferences: Map<string, string[]>;
    decisions: Map<string, string[]>;
  },
  sourceNodeIds: string[]
): string {
  const result: string[] = ['## Cross-Layer Pattern Summary', ''];

  if (patterns.decisions.size > 0) {
    result.push('### Key Decisions');
    for (const [decision, sources] of patterns.decisions) {
      if (sources.length >= 1) {
        result.push(`- ${decision}`);
      }
    }
    result.push('');
  }

  if (patterns.preferences.size > 0) {
    result.push('### User Preferences');
    for (const [pref, sources] of patterns.preferences) {
      if (sources.length >= 1) {
        result.push(`- ${pref}`);
      }
    }
    result.push('');
  }

  if (patterns.conventions.size > 0) {
    result.push('### Conventions & Standards');
    for (const [conv, sources] of patterns.conventions) {
      if (sources.length >= 1) {
        result.push(`- ${conv}`);
      }
    }
    result.push('');
  }

  if (patterns.tools.size > 0) {
    const toolCounts = Array.from(patterns.tools.entries())
      .map(([tool, sources]) => ({ tool, count: sources.length }))
      .sort((a, b) => b.count - a.count);

    result.push('### Tools Used');
    result.push(`_${toolCounts.slice(0, 10).map(t => `${t.tool} (${t.count}x)`).join(', ')}_`);
    result.push('');
  }

  if (patterns.files.size > 0) {
    const fileCounts = Array.from(patterns.files.entries())
      .map(([file, sources]) => ({ file, count: sources.length }))
      .sort((a, b) => b.count - a.count);

    result.push('### Key Files');
    result.push(`_${fileCounts.slice(0, 10).map(f => f.file).join(', ')}_`);
    result.push('');
  }

  result.push(`_Extracted from ${sourceNodeIds.length} source nodes_`);

  return result.join('\n');
}
