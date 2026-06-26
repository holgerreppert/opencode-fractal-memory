export function compressGitStatus(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return raw;

  const branch = lines.find(l => l.startsWith("On branch ") || l.startsWith("HEAD detached at "));
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("Changes to be committed:")) continue;
    if (s.startsWith("Changes not staged for commit:")) continue;
    if (s.startsWith("Untracked files:")) continue;
    if (s.startsWith("  (use")) continue;
    if (s.startsWith("no changes")) break;
    if (s.startsWith("\t") || s.startsWith("  ")) {
      const clean = s.replace(/^(modified|new file|deleted|renamed):\s*/i, "").trim();
      if (clean && !clean.startsWith("(")) {
        if (staged.length < 5) staged.push(clean);
      }
    }
  }

  if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
    const m = lines.find(l => /nothing to commit|up to date/i.test(l));
    if (m) return "clean";
  }

  const parts: string[] = [];
  if (branch) parts.push(branch.trim());
  if (staged.length > 0) parts.push(`${staged.length} staged`);
  if (unstaged.length > 0) parts.push(`${unstaged.length} unstaged`);
  if (untracked.length > 0) parts.push(`${untracked.length} untracked`);

  return parts.length > 0 ? parts.join(" | ") : raw;
}

export function compressGitLog(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("commit ")) {
      const sha = trimmed.slice(7, 14);
      let msg = "";
      for (let j = i + 1; j < lines.length; j++) {
        const cl = lines[j] ?? "";
        const trimmedCl = cl.trim();
        if (trimmedCl.startsWith("commit ") || !trimmedCl) break;
        if (cl.startsWith("    ")) msg = trimmedCl;
      }
      result.push(`${sha} ${msg}`);
    }
  }
  return result.length > 0 ? result.join("\n") : raw;
}

export function compressGitDiff(raw: string): string {
  const lines = raw.split("\n");
  const changed: string[] = [];
  const diffs: string[] = [];
  let added = 0;
  let removed = 0;
  let insideHunk = false;
  let lineCount = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git a/")) {
      const name = line.replace(/^diff --git a\//, "").replace(/\s+b\/.*/, "");
      changed.push(name);
      insideHunk = false;
    } else if (line.startsWith("index ") || line.startsWith("similarity index ") || line.startsWith("new file ") || line.startsWith("deleted file ")) {
      continue;
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    } else if (line.startsWith("@@")) {
      insideHunk = true;
      lineCount = 0;
    } else if (insideHunk && line.startsWith("+") && !line.startsWith("+++")) {
      added++;
      lineCount++;
      if (lineCount <= 20) diffs.push(line);
      else if (lineCount === 21) diffs.push("  ...");
    } else if (insideHunk && line.startsWith("-") && !line.startsWith("---")) {
      removed++;
      lineCount++;
      if (lineCount <= 20) diffs.push(line);
      else if (lineCount === 21) diffs.push("  ...");
    } else if (insideHunk && line.startsWith(" ")) {
      lineCount++;
      if (lineCount <= 3) diffs.push(line);
      else if (lineCount === 4) diffs.push(`  ... (${changed.length > 0 ? (changed[changed.length - 1]!.split("/").pop() ?? "") : ""} unchanged context)`);
    }
  }

  const parts: string[] = [`${changed.length} file${changed.length !== 1 ? "s" : ""} changed, +${added} -${removed}`];
  parts.push(...diffs);
  return parts.join("\n");
}
