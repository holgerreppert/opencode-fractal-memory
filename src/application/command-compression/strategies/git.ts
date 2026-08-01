const GIT_STATUS_KEEP_FILES = 50;

// Porcelain v1: "XY path" where X=staged, Y=unstaged (space=unmodified), "?? " untracked.
const PORCELAIN_RE = /^([ MARC?D]{1,2})\s+(.*)$/;

export function compressGitStatus(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return raw;

  const branch = lines.find(l => l.startsWith("On branch ") || l.startsWith("HEAD detached at "));
  const changed: string[] = [];
  let total = 0;

  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("Changes to be committed:")) continue;
    if (s.startsWith("Changes not staged for commit:")) continue;
    if (s.startsWith("Untracked files:")) continue;
    if (s.startsWith("  (use")) continue;
    if (s.startsWith("no changes")) break;
    if (/^(modified|new file|deleted|renamed):\s*/i.test(s)) {
      const clean = s.replace(/^(modified|new file|deleted|renamed):\s*/i, "").trim();
      if (clean && !clean.startsWith("(")) {
        total++;
        if (changed.length < GIT_STATUS_KEEP_FILES) changed.push(clean);
      }
    } else if (line.startsWith("\t") || s.startsWith("?? ") || s.startsWith("!")) {
      const name = s.replace(/^(\?\?\s*|!\s*)/, "").trim();
      if (name) {
        total++;
        if (changed.length < GIT_STATUS_KEEP_FILES) changed.push(`? ${name}`);
      }
    } else {
      const pm = s.match(PORCELAIN_RE);
      if (pm) {
        const status = pm[1]!;
        const name = pm[2]!.trim();
        if (name && !name.startsWith("(")) {
          total++;
          if (changed.length < GIT_STATUS_KEEP_FILES) {
            const marker = status.includes("?") ? "?" : status.includes("U") ? "!" : status.trim();
            changed.push(`${marker} ${name}`);
          }
        }
      }
    }
  }

  if (changed.length === 0 && total === 0) {
    const m = lines.find(l => /nothing to commit|up to date|no changes added/i.test(l));
    if (m) return "clean";
  }

  // The changed-file list is the payload: always keep the file paths.
  const parts: string[] = [];
  if (branch) parts.push(branch.trim());
  if (changed.length > 0) parts.push(changed.join("\n"));
  if (total > changed.length) parts.push(`… +${total - changed.length} more files`);

  return parts.join("\n");
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

const GIT_QUICK_MIN_CHARS = 300;

export function compressGitPush(raw: string): string {
  if (raw.length < GIT_QUICK_MIN_CHARS) return raw;
  const lines = raw.split("\n").filter(Boolean);
  const branch = lines.find(l => /^To\s/.test(l) || l.includes("->"));
  const summary = lines.find(l => /\d+\s+files?\s+changed/i.test(l) || /\.\./.test(l));
  const refs = lines.filter(l => /^\s+[a-f0-9]{7,}\./.test(l));
  if (branch && summary) {
    return `${summary} | pushed to ${branch.trim()}`;
  }
  if (refs.length > 0) {
    return `${refs.length} refs pushed`;
  }
  return lines.slice(0, 3).join("\n");
}

export function compressGitCommit(raw: string): string {
  if (raw.length < GIT_QUICK_MIN_CHARS) return raw;
  const lines = raw.split("\n").filter(Boolean);
  const hash = lines.find(l => /^\[[\w-]+\s+[a-f0-9]+/.test(l));
  const summary = lines.find(l => /^\d+\s+files?\s+changed/i.test(l) || /create mode|delete mode/.test(l));
  const parts: string[] = [];
  if (hash) parts.push(hash.trim());
  if (summary) parts.push(summary.trim());
  if (parts.length > 0) return parts.join(" | ");
  return lines.slice(0, 3).join("\n");
}

export function compressGitAdd(raw: string): string {
  if (raw.length < GIT_QUICK_MIN_CHARS) return raw;
  const lines = raw.split("\n").filter(Boolean);
  // "git add ." or "git add src/file.ts"
  const fileCount = lines.length;
  if (fileCount > 3) {
    return `${fileCount} files staged`;
  }
  return lines.slice(0, 3).join("\n");
}

export function compressGitPull(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  if (/Already up to date|Already up-to-date/i.test(raw)) {
    return "up to date";
  }
  if (/Fast-forward/i.test(raw)) {
    const summary = lines.filter(l => /^\s+\d+\s+files?\s+changed/i.test(l) || /Fast-forward/i.test(l));
    return summary.join(" | ") || lines.slice(0, 3).join("\n");
  }
  const clean = raw.trim();
  return clean ? clean.split("\n").slice(0, 3).join("\n") : raw;
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
