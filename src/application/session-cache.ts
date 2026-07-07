import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

const CACHE_DIR = path.join(os.homedir(), ".config", "opencode", "scratch");

interface SessionCacheEntry {
  output: string;
  strategy: string;
  timestamp: number;
}

interface SessionCacheData {
  version: number;
  sessionId: string;
  created: number;
  entries: Record<string, SessionCacheEntry>;
}

export class SessionCache {
  private data: SessionCacheData;
  private dirty = false;
  private readonly saveInterval: ReturnType<typeof setInterval> | null = null;
  private readonly filePath: string;

  constructor(sessionId: string, ttlMinutes = 60) {
    this.filePath = path.join(CACHE_DIR, `session-${sessionId}-cache.json`);
    this.data = this.load();
    this.data.sessionId = sessionId;

    // Auto-save every 30s
    this.saveInterval = setInterval(() => this.flush(), 30000);

    // Prune stale entries older than ttlMinutes
    this.prune(ttlMinutes);
  }

  private load(): SessionCacheData {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as SessionCacheData;
    } catch {
      return { version: 1, sessionId: "", created: Date.now(), entries: {} };
    }
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data), "utf-8");
      this.dirty = false;
    } catch { /* best-effort */ }
  }

  private prune(ttlMinutes: number): void {
    const cutoff = Date.now() - ttlMinutes * 60 * 1000;
    let pruned = 0;
    for (const [key, entry] of Object.entries(this.data.entries)) {
      if (entry.timestamp < cutoff) {
        delete this.data.entries[key];
        pruned++;
      }
    }
    if (pruned > 0) this.dirty = true;
  }

  getOutputHash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  get(hash: string): SessionCacheEntry | undefined {
    return this.data.entries[hash];
  }

  set(hash: string, output: string, strategy: string): void {
    this.data.entries[hash] = { output, strategy, timestamp: Date.now() };
    this.dirty = true;
  }

  get size(): number {
    return Object.keys(this.data.entries).length;
  }

  clear(): void {
    this.data.entries = {};
    this.dirty = true;
  }

  destroy(): void {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.flush();
  }
}

export function createSessionCache(sessionId: string): SessionCache {
  return new SessionCache(sessionId);
}
