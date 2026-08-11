import type { OutputTypeResult } from "../types";

export function compressNpmInstall(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n").filter(Boolean);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let audited = 0;
  let vulnerabilities = 0;
  const newPkgs: string[] = [];
  let inProgress = false;

  for (const line of lines) {
    const t = line.trim();
    const addMatch = t.match(/^\+ (\S+@\S+)/);
    if (addMatch) { added++; newPkgs.push(addMatch[1]!); continue; }
    const removeMatch = t.match(/^- (\S+@\S+)/);
    if (removeMatch) { removed++; continue; }

    if (/^added\s+(\d+)/i.test(t)) added = Math.max(added, parseInt(t.match(/^added\s+(\d+)/i)![1]!));
    if (/^removed\s+(\d+)/i.test(t)) removed = Math.max(removed, parseInt(t.match(/^removed\s+(\d+)/i)![1]!));
    if (/^changed\s+(\d+)/i.test(t)) changed = Math.max(changed, parseInt(t.match(/^changed\s+(\d+)/i)![1]!));
    if (/audited\s+(\d+)/i.test(t)) audited = Math.max(audited, parseInt(t.match(/audited\s+(\d+)/i)![1]!));
    if (/vulnerabilities/i.test(t)) {
      const vMatch = t.match(/(\d+)\s+vulnerabilit/i);
      if (vMatch) vulnerabilities = Math.max(vulnerabilities, parseInt(vMatch[1]!));
    }
    if (t.includes("up to date")) { inProgress = true; }
  }

  if (added === 0 && removed === 0 && changed === 0 && !inProgress) return null;

  const parts: string[] = [];
  if (inProgress && added === 0) parts.push("up to date");
  else {
    const counts: string[] = [];
    if (added > 0) counts.push(`+${added}`);
    if (removed > 0) counts.push(`-${removed}`);
    if (changed > 0) counts.push(`~${changed}`);
    parts.push(counts.join(" "));
    if (newPkgs.length > 0 && newPkgs.length <= 3) parts.push(`pkg: ${newPkgs.join(" ")}`);
    else if (newPkgs.length > 3) parts.push(`pkg: ${newPkgs.slice(0, 3).join(" ")} +${newPkgs.length - 3}`);
    if (audited > 0) parts.push(`audited:${audited}`);
    if (vulnerabilities > 0) parts.push(`vuln:${vulnerabilities}`);
  }

  const compressed = `[npm] ${parts.join(" | ")}`;
  if (compressed.length >= raw.length * 0.9) return null;
  return { type: "npm-install", compressed };
}
