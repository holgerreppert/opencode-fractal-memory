import type { Database } from "bun:sqlite";
import type { MemoryScope } from "../../../domain/ports/IMemoryStore";
import type { IConfigStore } from "../../../domain/ports/IConfigStore";
import { getConfig, setConfig } from "../../../storage/migrations";
import { withRetry } from "../../../storage/utils";

export class SqliteConfigStore implements IConfigStore {
  constructor(private getDb: (scope: MemoryScope) => Promise<Database>) {}

  async getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string> {
    const db = await this.getDb(scope);
    return getConfig(db, key, defaultValue);
  }

  async setConfig(scope: MemoryScope, key: string, value: string): Promise<void> {
    const db = await this.getDb(scope);
    await withRetry(() => setConfig(db, key, value));
  }
}
