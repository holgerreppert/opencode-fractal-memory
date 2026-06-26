export interface FileSummaryResult {
  summary: string;
  label: string;
}

export const SOURCE_FILE_EXTENSIONS = [
  'ts', 'js', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'md', 'txt',
];

export function generateFileLabel(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  const maxFileNameLen = 30;
  const truncatedName = fileName.length > maxFileNameLen ? fileName.slice(-maxFileNameLen) : fileName;
  const pathHash = Math.abs(filePath.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 46656).toString(36);
  return `file:${truncatedName}:${pathHash}`;
}

export function generateFileSummary(fileName: string, filePath: string, content: string, fileExt: string): string {
  const lines = content.split('\n');
  const summary: string[] = [];

  summary.push(`## File: ${fileName}`);
  summary.push(`Path: ${filePath}`);
  summary.push(`Lines: ${lines.length}`);
  summary.push("");

  if (['ts', 'js', 'tsx', 'jsx'].includes(fileExt)) {
    const exports: string[] = [];
    const imports: string[] = [];
    const functions: { name: string; line: number }[] = [];
    const classes: { name: string; line: number }[] = [];
    const interfaces: { name: string; line: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      const lineNum = i + 1;

      const typeImportMatch = trimmed.match(/^import\s+type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/);
      if (typeImportMatch?.[1]) imports.push(typeImportMatch[1]);
      const importMatch = trimmed.match(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch?.[1]) imports.push(importMatch[1]);
      const reExportMatch = trimmed.match(/^export\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/);
      if (reExportMatch?.[1]) imports.push(reExportMatch[1]);

      const exportMatch = trimmed.match(/^export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/);
      if (exportMatch?.[1]) exports.push(exportMatch[1]);

      const defaultExportMatch = trimmed.match(/^export\s+default\s+(\w+)/);
      if (defaultExportMatch?.[1]) exports.push(defaultExportMatch[1] + ' (default)');

      const funcMatch = trimmed.match(/^(?:export\s+)?function\s+(\w+)/);
      if (funcMatch?.[1]) functions.push({ name: funcMatch[1], line: lineNum });

      const constFuncMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
      if (constFuncMatch?.[1]) functions.push({ name: constFuncMatch[1], line: lineNum });

      const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
      if (classMatch?.[1]) classes.push({ name: classMatch[1], line: lineNum });

      const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch?.[1]) interfaces.push({ name: interfaceMatch[1], line: lineNum });

      const typeMatch = trimmed.match(/^(?:export\s+)?type\s+(\w+)/);
      if (typeMatch?.[1]) interfaces.push({ name: typeMatch[1] + ' (type)', line: lineNum });
    }

    if (imports.length > 0) {
      summary.push("### Imports");
      summary.push(imports.slice(0, 10).join(', '));
      if (imports.length > 10) summary.push(`... +${imports.length - 10} more`);
      summary.push("");
    }
    if (interfaces.length > 0) {
      summary.push("### Interfaces/Types");
      summary.push(interfaces.map(i => `${i.name}:${i.line}`).join(', '));
      summary.push("");
    }
    if (classes.length > 0) {
      summary.push("### Classes");
      summary.push(classes.map(c => `${c.name}:${c.line}`).join(', '));
      summary.push("");
    }
    if (functions.length > 0) {
      summary.push("### Functions");
      summary.push(functions.map(f => `${f.name}:${f.line}`).join(', '));
      summary.push("");
    }
    if (exports.length > 0) {
      summary.push("### Exports");
      summary.push(exports.join(', '));
      summary.push("");
    }
  }

  if (fileExt === 'py') {
    const functions: { name: string; line: number }[] = [];
    const classes: { name: string; line: number }[] = [];
    const imports: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      const lineNum = i + 1;

      const importMatch = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(\S+)/);
      if (importMatch?.[1] && importMatch[2]) imports.push(importMatch[1] + '.' + importMatch[2]);
      if (importMatch?.[1] === undefined && importMatch?.[2]) imports.push(importMatch[2]);

      const funcMatch = trimmed.match(/^(?:def\s+)(\w+)/);
      if (funcMatch?.[1] && !trimmed.startsWith('#')) functions.push({ name: funcMatch[1], line: lineNum });

      const classMatch = trimmed.match(/^class\s+(\w+)/);
      if (classMatch?.[1]) classes.push({ name: classMatch[1], line: lineNum });
    }

    if (imports.length > 0) { summary.push("### Imports"); summary.push(imports.slice(0, 10).join(', ')); summary.push(""); }
    if (classes.length > 0) {
      summary.push("### Classes");
      summary.push(classes.map(c => `${c.name}:${c.line}`).join(', '));
      summary.push("");
    }
    if (functions.length > 0) {
      summary.push("### Functions");
      summary.push(functions.map(f => `${f.name}:${f.line}`).join(', '));
      summary.push("");
    }
  }

  if (fileExt === 'md') {
    const headings: { text: string; level: number }[] = [];
    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch?.[1] && headingMatch[2]) headings.push({ text: headingMatch[2], level: headingMatch[1].length });
    }
    if (headings.length > 0) {
      summary.push("### Structure");
      summary.push(headings.map(h => '  '.repeat(h.level - 1) + h.text).join('\n'));
      summary.push("");
    }
  }

  const preview = lines.slice(0, 5).filter((l: string) => l.trim()).join('\n');
  if (preview) { summary.push("### Preview"); summary.push("```\n" + preview + "\n```"); }

  return summary.join('\n');
}
