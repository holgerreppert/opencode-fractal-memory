import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { SessionCache } from "../session-cache";

export const DEDUP_CACHE = new Map<string, { output: string; strategy: string }>();
export const DELTA_CACHE = new Map<string, { raw: string; strategy: string }>();
const SCRATCH_DIR = path.join(os.homedir(), ".config", "opencode", "scratch");

export function ensureScratchDir(): void {
  try { fs.mkdirSync(SCRATCH_DIR, { recursive: true }); } catch { /* best-effort */ }
}

export function contentSnippet(text: string, maxChars = 120): string {
  if (!text) return "";
  const lines = text.split("\n");
  let snippet = "";
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed) snippet += (snippet ? "↵" : "") + trimmed.slice(0, Math.min(trimmed.length, 80));
    if (trimmed.length > 80) snippet += "…";
    if (snippet.length >= maxChars) break;
  }
  return snippet.slice(0, maxChars);
}

export function contentPreview(text: string, maxChars = 2000): string {
  if (!text || text.length <= maxChars) return text ?? "";
  return text.slice(0, maxChars) + "\n… [truncated]";
}

export function offloadPathFor(output: string): string {
  const hash = createHash("sha256").update(output).digest("hex").slice(0, 16);
  return path.join(SCRATCH_DIR, `${hash}.out`);
}

export function offloadOutput(output: string): string | null {
  ensureScratchDir();
  const outPath = offloadPathFor(output);
  try {
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, output, "utf-8");
    }
    const lines = output.split("\n").length;
    return `[Output offloaded: ${output.length} chars, ${lines} lines — use \`cat ${outPath}\` to see full]\n`;
  } catch {
    return null;
  }
}

// Extract identifiers (SHAs, UUIDs, versions, ticket codes) from dropped
// content so lossy compression can never silently lose a hash or id.
const ID_RE = /\b(?:[a-f0-9]{7,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z]+-\d+|\d+\.\d+\.\d+)\b/gi;

export function extractIdentifiers(text: string, cap = 16): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const matches = text.match(ID_RE) ?? [];
  for (const m of matches) {
    const normalized = m.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(m);
    if (out.length >= cap) break;
  }
  return out;
}

export function droppedIdentifiers(raw: string, compressed: string, cap = 16): string[] {
  const rawIds = extractIdentifiers(raw, 64);
  const compressedLower = compressed.toLowerCase();
  return rawIds.filter(id => !compressedLower.includes(id.toLowerCase())).slice(0, cap);
}

export async function purgeOldScratch(): Promise<void> {
  try {
    const cutoff = Date.now() - 86400000;
    const entries = await fs.promises.readdir(SCRATCH_DIR);
    for (const f of entries) {
      const fp = path.join(SCRATCH_DIR, f);
      try {
        const stat = await fs.promises.stat(fp);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(fp);
        }
      } catch { /* best-effort per-file */ }
    }
  } catch { /* best-effort */ }
}

const SESSION_CACHES = new Map<string, SessionCache>();

export function getSessionCache(sessionId: string): SessionCache | null {
  if (!sessionId) return null;
  if (SESSION_CACHES.has(sessionId)) return SESSION_CACHES.get(sessionId)!;
  try {
    const cache = new SessionCache(sessionId, 60);
    SESSION_CACHES.set(sessionId, cache);
    return cache;
  } catch { return null; }
}

export function trySessionCache(cache: SessionCache | null, raw: string): { output: string; strategy: string } | null {
  if (!cache) return null;
  const hash = cache.getOutputHash(raw);
  const entry = cache.get(hash);
  if (entry) return { output: entry.output, strategy: entry.strategy };
  return null;
}

export function recordSessionCache(cache: SessionCache | null, raw: string, output: string, strategy: string): void {
  if (!cache) return;
  const hash = cache.getOutputHash(raw);
  cache.set(hash, output, strategy);
}
