import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../storage/migrations";
import { withRetryableTransaction } from "../../storage/utils";
import { memLog } from "../../logging";
import type { MemoryScope } from "../../storage/types";

export function scopeDbPath(projectDirectory: string, scope: MemoryScope, globalDbPath?: string): string {
  return globalDbPath ?? path.join(os.homedir(), ".config", "opencode", "memory.db");
}

export class DbProvider {
  private dbs: Map<string, Database> = new Map();
  private dbInitPromises: Map<string, Promise<Database>> = new Map();
  private readonly projectDir: string;
  private readonly globalDbPath: string | undefined;

  constructor(projectDirectory: string, globalDbPath?: string) {
    this.projectDir = projectDirectory;
    this.globalDbPath = globalDbPath;
  }

  get projectDirectory(): string {
    return this.projectDir;
  }

  getDb(_scope?: MemoryScope): Promise<Database> {
    const key = this.projectDir;
    if (this.dbs.has(key)) {
      return Promise.resolve(this.dbs.get(key)!);
    }

    const existing = this.dbInitPromises.get(key);
    if (existing) return existing;

    const promise = this.initDb(key);
    this.dbInitPromises.set(key, promise);

    try {
      promise.catch(() => {
        this.dbInitPromises.delete(key);
      });
      return promise;
    } catch (err) {
      this.dbInitPromises.delete(key);
      throw err;
    }
  }

  getGlobalDb(): Promise<Database> {
    return this.getDb("global");
  }

  withTransaction<T>(db: Database, operation: () => T | Promise<T>): Promise<T> {
    return withRetryableTransaction(db, operation);
  }

  private async initDb(key: string): Promise<Database> {
    const dbPath = scopeDbPath(this.projectDir, "global", this.globalDbPath);

    const dbDir = path.dirname(dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    const db = new Database(dbPath);

    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA busy_timeout = 5000");

    runMigrations(db);

    this.dbs.set(key, db);
    this.dbInitPromises.delete(key);
    return db;
  }

  async close(): Promise<void> {
    for (const [key, db] of this.dbs) {
      try {
        db.close();
      } catch (error) {
        memLog("error", "storage", `Error closing database ${key}:`, { error });
      }
    }
    this.dbs.clear();
  }
}
